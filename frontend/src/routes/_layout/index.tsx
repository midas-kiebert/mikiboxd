/**
 * TanStack Router route module for the home feed. It connects URL state to the
 * matching page component.
 *
 * Every filter dimension lives in the URL, so a filtered feed is linkable and
 * back/forward step through filter changes. The schema itself is in
 * `features/showtimes/feed-params.ts`.
 */
import { createFileRoute } from "@tanstack/react-router"

import DeferredPage from "@/components/Common/DeferredPage"
import MainShowtimesPage from "@/components/Showtimes/MainShowtimesPage"
import {
  type FeedSearchInput,
  parseFeedParams,
} from "@/features/showtimes/feed-params"

//@ts-ignore
export const Route = createFileRoute("/_layout/")({
  component: DeferredMainShowtimesPage,
  validateSearch: (search: FeedSearchInput) => parseFeedParams(search),
})

function DeferredMainShowtimesPage() {
  return (
    <DeferredPage>
      <MainShowtimesPage />
    </DeferredPage>
  )
}
