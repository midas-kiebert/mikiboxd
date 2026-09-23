/**
 * TanStack Router route module for the app's `/friend-showtimes/<id>` links:
 * the home feed narrowed to that friend, as `/$userId/showtimes` does.
 */
import { createFileRoute, redirect } from "@tanstack/react-router"

import { friendFeedSearch } from "@/features/showtimes/feed-params"

export const Route = createFileRoute("/friend-showtimes/$friendId" as never)({
  beforeLoad: ({ params }: { params: { friendId: string } }) => {
    throw redirect(
      params.friendId
        ? { to: "/", search: friendFeedSearch(params.friendId) as never }
        : { to: "/friends" as never },
    )
  },
})
