import FriendsPage from "@/components/Friends/FriendsPage"
/**
 * TanStack Router route module for friends. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

//@ts-ignore
export const Route = createFileRoute("/_layout/friends")({
  component: FriendsPage,
})
