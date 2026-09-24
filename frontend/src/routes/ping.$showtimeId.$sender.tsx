import {
  Link,
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { ApiError, ShowtimesService } from "shared"

import { primeSession } from "@/auth/session"
import { useIsSignedIn } from "@/auth/useSession"
import { AuthShell } from "@/components/Auth/AuthShell"
import InstallAppGate from "@/components/Common/InstallAppGate"
import {
  formatScreeningTime,
  useShowtimeInviteContext,
} from "@/features/install-prompt"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import { openInShowtimePanelOnArrival } from "@/features/showtimes/showtime-panel-slot"

const getErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiError)) return "Could not process the invite link."

  const body = error.body
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as { detail?: unknown }).detail === "string"
  ) {
    return (body as { detail: string }).detail
  }

  return `Could not process the invite link (${error.status}).`
}

export const Route = createFileRoute("/ping/$showtimeId/$sender" as never)({
  component: PingLinkRoute,
  // Outside `_layout`, so the session is read here: signed in or not decides
  // whether the invite is recorded now or after logging in.
  beforeLoad: async () => {
    await primeSession()
  },
})

function PingLinkRoute() {
  const { showtimeId, sender } = useParams({ strict: false }) as {
    showtimeId: string
    sender: string
  }
  const invite = useShowtimeInviteContext(showtimeId, sender)
  const senderName = invite?.sender_name ?? null

  return (
    <InstallAppGate
      headline={
        senderName
          ? `${senderName} invited you to a screening`
          : "You have been invited to a screening"
      }
      card={
        invite
          ? {
              posterUrl: invite.movie_poster_link,
              title: invite.movie_title,
              subtitle: `${formatScreeningTime(invite.datetime)} · ${invite.cinema_name}`,
            }
          : null
      }
      body="MiKiNO is a free app for going to the cinema with friends. It shows what is on at your selected cinemas, which films your friends want to see, and lets you invite each other to screenings."
      nextStep={
        senderName
          ? `Install it and create an account to reply to ${senderName}'s invite.`
          : "Install it and create an account to reply to the invite."
      }
      iosReopenHint="After installing, open the link again and the invite will be waiting for you."
      skipLabel="I'll use the website instead"
    >
      <PingLinkPage />
    </InstallAppGate>
  )
}

/**
 * What an invite link does on the web: record the invite, then show the
 * screening where invites are normally seen — the screenings feed, with it open
 * in the side panel. It used to stop on a page of its own ("Screening Invite"
 * with an "Open Invites" button), an extra step between the link and the thing
 * it was about. A guest is sent to log in and brought back here first, since
 * an invite can only be recorded on an account.
 */
function PingLinkPage() {
  const navigate = useNavigate()
  const isSignedIn = useIsSignedIn()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasStartedRef = useRef(false)

  const [pathShowtimeId, pathSender] = useMemo(() => {
    const match = window.location.pathname.match(/^\/ping\/([^/]+)\/([^/]+)$/)
    if (!match) return ["", ""]

    const rawShowtimeId = match[1] ?? ""
    const rawSender = match[2] ?? ""
    try {
      return [decodeURIComponent(rawShowtimeId), decodeURIComponent(rawSender)]
    } catch {
      return [rawShowtimeId, rawSender]
    }
  }, [])

  useEffect(() => {
    if (hasStartedRef.current) return
    hasStartedRef.current = true

    const showtimeId = Number.parseInt(pathShowtimeId.trim(), 10)
    const token = pathSender.trim()
    if (!Number.isInteger(showtimeId) || showtimeId <= 0 || !token) {
      setErrorMessage("This invite link is not valid.")
      return
    }

    if (!isSignedIn) {
      void navigate({
        to: "/login",
        search: { redirect: window.location.pathname },
        replace: true,
      })
      return
    }

    const openInvite = async () => {
      await ShowtimesService.receivePingFromLink({ showtimeId, token })
      // Fetched after recording it, so the panel opens already saying who
      // invited you.
      const showtime = await ShowtimesService.getShowtimeById({ showtimeId })
      openInShowtimePanelOnArrival(showtime)
      void navigate({ to: "/", search: defaultFeedParams, replace: true })
    }
    openInvite().catch((error: unknown) =>
      setErrorMessage(getErrorMessage(error)),
    )
  }, [isSignedIn, navigate, pathSender, pathShowtimeId])

  return (
    <AuthShell
      title={
        errorMessage
          ? "This invite could not be opened"
          : "Opening your invite…"
      }
      lede={errorMessage ?? "Taking you to the screening."}
    >
      {errorMessage ? (
        <div className="au-card">
          <Link
            to="/"
            search={defaultFeedParams}
            className="au-button au-button--primary"
          >
            Go to screenings
          </Link>
        </div>
      ) : null}
    </AuthShell>
  )
}
