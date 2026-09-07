/**
 * TanStack Router route module for your own agenda. It connects URL state to
 * the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

import RequireAccount from "@/components/Common/RequireAccount"
import MyShowtimesPage from "@/components/Showtimes/MyShowtimesPage"
import { parseFeedParams } from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/me/showtimes")({
  component: GatedMyShowtimesPage,
  validateSearch: (search: Record<string, unknown>) => parseFeedParams(search),
})

function GatedMyShowtimesPage() {
  return (
    <RequireAccount feature="your agenda">
      <MyShowtimesPage />
    </RequireAccount>
  )
}
