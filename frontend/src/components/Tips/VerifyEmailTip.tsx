/**
 * "Confirm your email" — the app's `VerifyEmailTip`, on the website.
 *
 * The app's one tip that is unfinished business rather than a suggestion: it
 * comes back on every start until the address is confirmed, and has no "Don't
 * show this again". The website's "start" is a browser session — closing it
 * holds until the tab is closed, so it does not reappear on every navigation.
 * Closing is remembered per address: changing the email in Settings brings it
 * straight back for the new one (Settings has no confirmation dialog of its own
 * any more — it used to open a second, plainer one alongside this).
 *
 * The address is spelled out because the commonest reason a link never
 * arrives is a typo in it. Waits while the first-run intro is up, like the
 * app's tips do. Mounted once, in `_layout`.
 */
import { Portal } from "@chakra-ui/react"
import { useState } from "react"
import { MdMarkEmailUnread } from "react-icons/md"
import { MeService } from "shared/client"
import useAuth from "shared/hooks/useAuth"

import { useIsSignedIn } from "@/auth/useSession"
import {
  DialogBackdrop,
  DialogBody,
  DialogContent,
  DialogRoot,
} from "@/components/ui/dialog"
import { useIntroPending } from "@/features/intro/intro"

import "@/components/Auth/auth.css"
import "@/components/Intro/intro.css"
import "./tips.css"

const CLOSED_THIS_SESSION_KEY = "mikino.verify-email.closed"

/** The address the tip was last closed for in this session, if any. */
const readClosedFor = (): string | null => {
  try {
    return sessionStorage.getItem(CLOSED_THIS_SESSION_KEY)
  } catch {
    return null
  }
}

const VerifyEmailTip = () => {
  const isSignedIn = useIsSignedIn()
  const { user } = useAuth()
  const introPending = useIntroPending()
  const [closedFor, setClosedFor] = useState(readClosedFor)
  const [hasResent, setHasResent] = useState(false)
  // A "Link sent" for the old address never carries over to a new one.
  const [shownFor, setShownFor] = useState(user?.email ?? null)
  if ((user?.email ?? null) !== shownFor) {
    setShownFor(user?.email ?? null)
    setHasResent(false)
  }

  // Only on an answer we have: `user` undefined is "not loaded", not "unconfirmed".
  if (
    !isSignedIn ||
    !user ||
    user.email_verified ||
    introPending ||
    closedFor === user.email
  )
    return null

  const close = () => {
    try {
      sessionStorage.setItem(CLOSED_THIS_SESSION_KEY, user.email)
    } catch {
      // Then it just comes back on the next page load.
    }
    setClosedFor(user.email)
  }

  return (
    <DialogRoot
      open
      placement="center"
      size="sm"
      onOpenChange={(details) => {
        if (!details.open) close()
      }}
    >
      <Portal>
        <DialogBackdrop className="in-backdrop" />
        <DialogContent className="in-dialog" backdrop={false}>
          <DialogBody p={0}>
            <div className="tp-body">
              <span className="tp-icon" aria-hidden>
                <MdMarkEmailUnread size={26} />
              </span>
              <h2 className="in-title">Confirm your email</h2>
              <p className="in-message">
                We sent a link to this address. Open it to confirm the address
                is yours. You'll need it to get back in if you forget your
                password, and nothing can be emailed to you until you do.
              </p>
              <p className="tp-address">{user.email}</p>
              <p className="in-help">
                {hasResent
                  ? "Check your inbox, and your spam folder. Wrong address? You can change it in Settings."
                  : "Already opened it? It may take a moment."}
              </p>
              <div className="in-actions">
                <button type="button" className="au-button" onClick={close}>
                  Close
                </button>
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
                  {hasResent ? "Link sent" : "Send the link again"}
                </button>
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </Portal>
    </DialogRoot>
  )
}

export default VerifyEmailTip
