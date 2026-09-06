import MyShowtimesPage from "@/components/Showtimes/MyShowtimesPage"
/**
 * TanStack Router route module for me / showtimes. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

import RequireAccount from "@/components/Common/RequireAccount"

//@ts-ignore
export const Route = createFileRoute("/_layout/me/showtimes")({
  component: GatedMyShowtimesPage,
})

function GatedMyShowtimesPage() {
  return (
    <RequireAccount feature="your agenda">
      <MyShowtimesPage />
    </RequireAccount>
  )
}
