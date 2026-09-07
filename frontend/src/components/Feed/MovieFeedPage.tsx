/**
 * A feed of films rather than screenings — the films tab, and the home feed
 * when "one row per film" is on.
 *
 * Same chrome as the showtime feed, different rows. There is no detail panel:
 * a film's detail is its own page.
 */
import { useRef } from "react"
import type { ReactNode } from "react"
import type { MovieSummaryPublic } from "shared"

import FeedPageShell, { type FeedChrome } from "@/components/Feed/FeedPageShell"
import MovieCard from "@/components/Movies/MovieCard"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"

export type MovieFeedLike = FeedChrome & {
  movies: MovieSummaryPublic[]
  fetchNextPage: () => void
}

type MovieFeedPageProps = {
  feed: MovieFeedLike
  header?: ReactNode
  emptyText?: string
  filteredEmptyText?: string
  showPresets?: boolean
  showGroupToggle?: boolean
}

const MovieFeedPage = ({
  feed,
  header,
  emptyText = "No films showing.",
  filteredEmptyText = "No films match these filters.",
  showPresets = true,
  showGroupToggle = false,
}: MovieFeedPageProps) => {
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  useInfiniteScroll({
    fetchNextPage: feed.fetchNextPage,
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    loadMoreRef,
    rootMargin: "400px",
  })

  return (
    <FeedPageShell
      feed={feed}
      resultCount={feed.movies.length}
      header={header}
      emptyText={emptyText}
      filteredEmptyText={filteredEmptyText}
      showPresets={showPresets}
      showGroupToggle={showGroupToggle}
      searchPlaceholder="Search films…"
      resultNoun="films"
      loadMoreRef={loadMoreRef}
    >
      {feed.movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} />
      ))}
    </FeedPageShell>
  )
}

export default MovieFeedPage
