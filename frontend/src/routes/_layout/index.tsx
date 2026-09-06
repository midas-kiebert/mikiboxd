/**
 * TanStack Router route module for the home feed. It connects URL state to the
 * matching page component.
 *
 * Every filter dimension lives in the URL, so a filtered feed is linkable and
 * back/forward step through filter changes. The schema itself is in
 * `features/showtimes/feed-params.ts`.
 */
import { createFileRoute } from "@tanstack/react-router"

import MainShowtimesPage from "@/components/Showtimes/MainShowtimesPage"
import { parseFeedParams } from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/")({
  component: MainShowtimesPage,
  validateSearch: (search: Record<string, unknown>) => parseFeedParams(search),
})
