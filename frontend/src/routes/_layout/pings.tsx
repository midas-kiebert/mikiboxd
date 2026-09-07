/**
 * TanStack Router route module for Activity.
 *
 * Keeps the `/pings` path because the app links to it, but the page is no
 * longer invites-only: it is the merged notification feed the app's Activity
 * tab shows.
 */
import { createFileRoute } from "@tanstack/react-router"

import RequireAccount from "@/components/Common/RequireAccount"
import NotificationsPage from "@/components/Notifications/NotificationsPage"

//@ts-ignore
export const Route = createFileRoute("/_layout/pings")({
  component: GatedNotificationsPage,
})

function GatedNotificationsPage() {
  return (
    <RequireAccount feature="your activity">
      <NotificationsPage />
    </RequireAccount>
  )
}
