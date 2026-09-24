/**
 * TanStack Router route module for friends. `?mode=discover` opens on "Find
 * people", as the app's `?tab=users` deep link does; the friends list is the
 * default and stays out of the URL.
 */
import { createFileRoute } from "@tanstack/react-router"

import DeferredPage from "@/components/Common/DeferredPage"
import RequireAccount from "@/components/Common/RequireAccount"
import FriendsPage from "@/components/Friends/FriendsPage"
import { parseFriendsMode } from "@/components/Friends/friends-modes"

//@ts-ignore
export const Route = createFileRoute("/_layout/friends")({
  component: GatedFriendsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    mode: parseFriendsMode(search.mode),
  }),
})

function GatedFriendsPage() {
  return (
    <RequireAccount feature="your friends">
      <DeferredPage>
        <FriendsPage />
      </DeferredPage>
    </RequireAccount>
  )
}
