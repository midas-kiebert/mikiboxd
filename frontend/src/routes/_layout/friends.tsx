import FriendsPage from "@/components/Friends/FriendsPage"
/**
 * TanStack Router route module for friends. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

import RequireAccount from "@/components/Common/RequireAccount"

//@ts-ignore
export const Route = createFileRoute("/_layout/friends")({
  component: GatedFriendsPage,
})

function GatedFriendsPage() {
  return (
    <RequireAccount feature="your friends">
      <FriendsPage />
    </RequireAccount>
  )
}
