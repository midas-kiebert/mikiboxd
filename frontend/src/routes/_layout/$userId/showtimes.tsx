import type { UUID } from "node:crypto"
import ShowtimesPage from "@/components/Showtimes/ShowtimesPage"
/**
 * TanStack Router route module for $userId / showtimes. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

//@ts-ignore
export const Route = createFileRoute("/_layout/$userId/showtimes")({
  component: () => {
    const params = Route.useParams()
    const { userId } = params as { userId: UUID }

    return <ShowtimesPage userId={userId} />
  },
})
