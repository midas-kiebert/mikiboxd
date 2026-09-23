/**
 * TanStack Router route module for the films feed. It connects URL state to the
 * matching page component.
 *
 * Shares its search schema with the home feed, so filters carry across when you
 * switch between them. The schema itself is in
 * `features/showtimes/feed-params.ts`.
 */
import { createFileRoute } from "@tanstack/react-router"

import DeferredPage from "@/components/Common/DeferredPage"
import MoviesPage from "@/components/Movies/MoviesPage"
import {
  type FeedSearchInput,
  parseFeedParams,
} from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/movies")({
  component: DeferredMoviesPage,
  validateSearch: (search: FeedSearchInput) => parseFeedParams(search),
})

function DeferredMoviesPage() {
  return (
    <DeferredPage>
      <MoviesPage />
    </DeferredPage>
  )
}
