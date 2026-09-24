/**
 * TanStack Router route module for the old address of a friend's agenda.
 *
 * A friend's agenda is no longer a page of its own: it is the home feed with
 * that one friend picked under "Only these friends" (`FeedParams.friends`),
 * headed by their name, picture and settings (`Feed/FeedSubjectHeader`). The
 * address stays so shared links, the app's links and bookmarks still land.
 */
import { createFileRoute, redirect } from "@tanstack/react-router"

import { friendFeedSearch } from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/$userId/showtimes")({
  beforeLoad: ({ params }: { params: { userId: string } }) => {
    throw redirect({
      to: "/",
      search: friendFeedSearch(params.userId) as never,
    })
  },
})
