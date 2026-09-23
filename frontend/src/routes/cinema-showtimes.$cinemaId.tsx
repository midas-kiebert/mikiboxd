/**
 * TanStack Router route module for the old address of a cinema's programme.
 *
 * The app sends `/cinema-showtimes/<id>` links, so the address has to keep
 * working, but the page is gone: a cinema's programme is the home feed with
 * that one cinema picked, headed by its name, city and links
 * (`Feed/FeedSubjectHeader`).
 */
import { createFileRoute, redirect } from "@tanstack/react-router"

import { cinemaFeedSearch } from "@/features/showtimes/feed-params"

export const Route = createFileRoute("/cinema-showtimes/$cinemaId" as never)({
  beforeLoad: ({ params }: { params: { cinemaId: string } }) => {
    const cinemaId = Number.parseInt(params.cinemaId, 10)
    throw redirect({
      to: "/",
      search: (Number.isFinite(cinemaId)
        ? cinemaFeedSearch(cinemaId)
        : {}) as never,
    })
  },
})
