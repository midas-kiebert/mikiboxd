/**
 * TanStack Router route module for a friend's agenda. It connects URL state to
 * the matching page component.
 *
 * Shares its search schema with the other feeds, so filters carry across.
 */
import { createFileRoute } from "@tanstack/react-router"

import ShowtimesPage from "@/components/Showtimes/ShowtimesPage"
import { parseFeedParams } from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/$userId/showtimes")({
  component: FriendAgendaRoute,
  validateSearch: (search: Record<string, unknown>) => parseFeedParams(search),
})

function FriendAgendaRoute() {
  const { userId } = Route.useParams() as { userId: string }
  return <ShowtimesPage userId={userId} />
}
