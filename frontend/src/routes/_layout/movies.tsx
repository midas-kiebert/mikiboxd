/**
 * TanStack Router route module for the films feed. It connects URL state to the
 * matching page component.
 *
 * Shares its search schema with the home feed, so filters carry across when you
 * switch between them. The schema itself is in
 * `features/showtimes/feed-params.ts`.
 */
import { createFileRoute } from "@tanstack/react-router"

import MoviesPage from "@/components/Movies/MoviesPage"
import { parseFeedParams } from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/movies")({
  component: MoviesPage,
  validateSearch: (search: Record<string, unknown>) => parseFeedParams(search),
})
