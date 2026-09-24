/**
 * TanStack Router route module for Activity: the app's Activity tab, on the
 * web. `?mode=` picks the slice, as the app's deep link does.
 */
import { createFileRoute } from "@tanstack/react-router"

import ActivityPage from "@/components/Activity/ActivityPage"
import { parseActivityMode } from "@/components/Activity/activity-modes"
import DeferredPage from "@/components/Common/DeferredPage"
import RequireAccount from "@/components/Common/RequireAccount"

//@ts-ignore
export const Route = createFileRoute("/_layout/activity")({
  component: GatedActivityPage,
  validateSearch: (search: Record<string, unknown>) => ({
    mode: parseActivityMode(search.mode),
  }),
})

function GatedActivityPage() {
  return (
    <RequireAccount feature="your activity">
      <DeferredPage>
        <ActivityPage />
      </DeferredPage>
    </RequireAccount>
  )
}
