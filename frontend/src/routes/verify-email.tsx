/**
 * Where the "Confirm your email" link lands on the web.
 *
 * The mailed link points here rather than at the API so that a phone with the
 * app installed opens it in the app (the path is in the universal/app links),
 * and everyone else gets a page that looks like the rest of the site. The
 * token itself is the proof, so confirming works signed in, signed out, or in
 * a browser that has never seen this account; what follows it depends on
 * which of those this is.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"
import { MdErrorOutline, MdMarkEmailRead, MdWifiOff } from "react-icons/md"
import { ApiError, MeService, UsersService } from "shared/client"
import useAuth from "shared/hooks/useAuth"

import { useIsSignedIn } from "@/auth/useSession"
import { AuthShell } from "@/components/Auth/AuthShell"
import { defaultFeedParams } from "@/features/showtimes/feed-params"

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmail,
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    ...(typeof search.token === "string" ? { token: search.token } : {}),
  }),
})

type Tone = "working" | "success" | "error"

const StatusIcon = ({
  tone,
  children,
}: { tone: Tone; children?: ReactNode }) => (
  <span
    className={
      tone === "working"
        ? "au-status-icon"
        : `au-status-icon au-status-icon--${tone}`
    }
    aria-hidden
  >
    {tone === "working" ? <span className="au-spinner" /> : children}
  </span>
)

function VerifyEmail() {
  // Read flow: route state and data hooks first, then derived state, then page JSX.
  const { token } = Route.useSearch()
  const isSignedIn = useIsSignedIn()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [hasResent, setHasResent] = useState(false)

  // A query rather than a mutation so the request is made once per token, however
  // many times the page mounts (StrictMode, a back-and-forward). Confirming is
  // idempotent on the backend, so a repeat would be harmless, just wasted.
  const confirmation = useQuery({
    queryKey: ["verifyEmail", token],
    queryFn: () =>
      UsersService.verifyEmail({ requestBody: { token: token ?? "" } }),
    enabled: Boolean(token),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })

  // The signed-in account's `email_verified` just changed underneath the cached
  // copy, and the "Confirm your email" dialog reads it.
  useEffect(() => {
    if (confirmation.isSuccess && isSignedIn) {
      void queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    }
  }, [confirmation.isSuccess, isSignedIn, queryClient])

  const isRejected =
    !token ||
    (confirmation.error instanceof ApiError &&
      confirmation.error.status === 400)
  // A dead link on an account that is confirmed anyway (an older link, opened
  // after a newer one) has still got the user what they came for.
  const isConfirmed =
    confirmation.isSuccess || (isRejected && user?.email_verified === true)

  const browseLink = (
    <Link
      to="/"
      search={defaultFeedParams}
      className="au-button au-button--primary"
    >
      {isSignedIn ? "Go to your showtimes" : "Browse showtimes"}
    </Link>
  )

  if (isConfirmed) {
    return (
      <AuthShell
        icon={
          <StatusIcon tone="success">
            <MdMarkEmailRead size={28} />
          </StatusIcon>
        }
        title="Email confirmed"
        lede="Thanks. We can now email you, and you can reset your password if you ever forget it."
      >
        {/* No address here: the link says which one it confirmed, and this
            browser may be signed in to a different account. */}
        <div className="au-card">
          {browseLink}
          {isSignedIn ? null : (
            <Link to="/login" className="au-button">
              Log in
            </Link>
          )}
        </div>
      </AuthShell>
    )
  }

  if (isRejected) {
    return (
      <AuthShell
        icon={
          <StatusIcon tone="error">
            <MdErrorOutline size={28} />
          </StatusIcon>
        }
        title="This link didn't work"
        lede="It may have expired, or been cut short on its way here. A new one takes a second."
      >
        <div className="au-card">
          {isSignedIn ? (
            <>
              {user ? <p className="au-card__address">{user.email}</p> : null}
              <button
                type="button"
                className="au-button au-button--primary"
                disabled={hasResent}
                onClick={() => {
                  // Painted first: the backend answers the same either way.
                  setHasResent(true)
                  MeService.resendEmailVerification().catch(() => {})
                }}
              >
                {hasResent ? "Link sent" : "Send a new link"}
              </button>
              <p className="au-card__note">
                {hasResent
                  ? "Check your inbox, and your spam folder."
                  : "Wrong address? You can change it in Settings."}
              </p>
            </>
          ) : (
            <>
              <Link to="/login" className="au-button au-button--primary">
                Log in to get a new link
              </Link>
              <p className="au-card__note">
                Once you're in, we'll offer to send one. The app does the same.
              </p>
            </>
          )}
        </div>
      </AuthShell>
    )
  }

  if (confirmation.isError) {
    return (
      <AuthShell
        icon={
          <StatusIcon tone="error">
            <MdWifiOff size={28} />
          </StatusIcon>
        }
        title="Couldn't confirm just now"
        lede="Your link is fine; we couldn't reach MiKiNO to check it."
      >
        <div className="au-card">
          <button
            type="button"
            className="au-button au-button--primary"
            disabled={confirmation.isFetching}
            onClick={() => void confirmation.refetch()}
          >
            {confirmation.isFetching ? "Trying again…" : "Try again"}
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      icon={<StatusIcon tone="working" />}
      title="Confirming your email"
      lede="One moment."
    >
      {null}
    </AuthShell>
  )
}
