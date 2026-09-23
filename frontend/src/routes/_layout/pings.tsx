/**
 * TanStack Router route module for the old Notifications address.
 *
 * Notifications are no longer a page but a panel under the bell in the top nav.
 * `/pings` stays because the app and the invite-link page still point at it:
 * it opens that panel over the home feed and replaces itself in the history,
 * so Back does not land on an empty route.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { useIsSignedIn } from "@/auth/useSession"
import RequireAccount from "@/components/Common/RequireAccount"
import { openNotificationPanel } from "@/components/Notifications/notification-panel"
import { defaultFeedParams } from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/pings")({
  component: NotificationsRedirect,
})

function NotificationsRedirect() {
  const isSignedIn = useIsSignedIn()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isSignedIn) return
    navigate({ to: "/", search: defaultFeedParams, replace: true }).then(
      openNotificationPanel,
    )
  }, [isSignedIn, navigate])

  // A guest has no notifications; the gate says so and offers a sign-in.
  return isSignedIn ? null : (
    <RequireAccount feature="your notifications">{null}</RequireAccount>
  )
}
