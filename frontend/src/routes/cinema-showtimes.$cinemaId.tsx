/**
 * TanStack Router route module for one cinema's programme.
 *
 * A deep-link target: the app sends `/cinema-showtimes/<id>` links here, so the
 * path is fixed and the route sits outside `_layout` (no sidebar). It used to
 * be a stub telling the visitor to open the app; it now shows the programme.
 */
import { createFileRoute } from "@tanstack/react-router"

import CinemaShowtimesPage from "@/components/Showtimes/CinemaShowtimesPage"
import { parseFeedParams } from "@/features/showtimes/feed-params"

export const Route = createFileRoute("/cinema-showtimes/$cinemaId" as never)({
  component: CinemaShowtimesRoute,
  validateSearch: (search: Record<string, unknown>) => parseFeedParams(search),
})

function CinemaShowtimesRoute() {
  const cinemaId = Number.parseInt(
    window.location.pathname.replace(/^\/cinema-showtimes\//, ""),
    10,
  )

  if (!Number.isFinite(cinemaId)) return null

  return <CinemaShowtimesPage cinemaId={cinemaId} />
}
