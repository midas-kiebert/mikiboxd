/**
 * TanStack Router route module for the old "Your agenda" address.
 *
 * Your agenda is no longer a page of its own: it is the home feed with
 * "Only my own plans" on (`mine`, in `features/showtimes/feed-params.ts`), so
 * it can be narrowed, grouped and left like any other set of filters. The
 * address stays so old links and bookmarks land there instead of on a 404.
 */
import { createFileRoute, redirect } from "@tanstack/react-router"

//@ts-ignore
export const Route = createFileRoute("/_layout/me/showtimes")({
  beforeLoad: () => {
    throw redirect({
      to: "/",
      search: { mine: true, status: "interested" } as never,
    })
  },
})
