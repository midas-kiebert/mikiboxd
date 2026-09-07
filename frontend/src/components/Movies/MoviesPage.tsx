/**
 * The films feed.
 *
 * Rebuilt on the same three pieces as the showtimes feed — `useMoviesFeed`,
 * `FeedLayout`, `FeedToolbar`, `FeedFilterRail` — rather than its own state,
 * its own filter dialog and its own layout. Both pages now filter on the same
 * eleven dimensions over the same URL state, so switching between them carries
 * your filters across, which is what `useSharedTabFilters` does in the app.
 *
 * The Letterboxd sync that used to fire here on every mount now belongs to
 * whoever is signed in; see `useMoviesFeed` for the data and this file for
 * nothing but composition.
 */
import { useEffect, useRef } from "react"
import { Button, Center, Flex, Spinner, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { MeService } from "shared"

import { useIsSignedIn } from "@/auth/useSession"
import FeedFilterRail from "@/components/Feed/FeedFilterRail"
import FeedLayout from "@/components/Feed/FeedLayout"
import FeedToolbar from "@/components/Feed/FeedToolbar"
import MovieCard from "@/components/Movies/MovieCard"
import { useMoviesFeed } from "@/features/showtimes/useMoviesFeed"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"

const MoviesPage = () => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const feed = useMoviesFeed()
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const hasSynced = useRef(false)

  useInfiniteScroll({
    fetchNextPage: feed.fetchNextPage,
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    loadMoreRef,
    rootMargin: "400px",
  })

  // Watched syncs independently of the watchlist: a throttled (429) watchlist
  // sync must not stop the watched list refreshing.
  const { mutate: syncWatchlist } = useMutation({
    mutationFn: () => MeService.syncWatchlist(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["movies"] }),
  })
  const { mutate: syncWatched } = useMutation({
    mutationFn: () => MeService.syncWatched(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["movies"] }),
  })

  // Both write to the account's Letterboxd mirror, so they are for members
  // only — a guest browsing films used to fire two 401s on arrival.
  useEffect(() => {
    if (!isSignedIn || hasSynced.current) return
    syncWatchlist()
    syncWatched()
    hasSynced.current = true
  }, [isSignedIn, syncWatchlist, syncWatched])

  return (
    <FeedLayout
      rail={<FeedFilterRail params={feed.params} onChange={feed.setParams} />}
      toolbar={
        <FeedToolbar
          params={feed.params}
          onChange={feed.setParams}
          onReset={feed.resetParams}
          activeFilterCount={feed.activeFilterCount}
          resultCount={feed.movies.length}
          searchPlaceholder="Search films…"
          resultNoun="films"
          showGroupToggle={false}
        />
      }
    >
      {feed.isLoading ? (
        <Center py={20}>
          <Spinner size="xl" />
        </Center>
      ) : null}

      {feed.isEmpty ? (
        <Center py={20}>
          <Flex direction="column" align="center" gap={3}>
            <Text color="gray.500">
              {feed.isFilteredEmpty
                ? "No films match these filters."
                : "No films showing."}
            </Text>
            {feed.isFilteredEmpty ? (
              <Button size="sm" variant="surface" onClick={feed.resetParams}>
                Clear filters
              </Button>
            ) : null}
          </Flex>
        </Center>
      ) : null}

      {feed.movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} />
      ))}

      {feed.hasNextPage ? (
        <div ref={loadMoreRef} style={{ height: "1px" }} />
      ) : null}

      {feed.isFetchingNextPage ? (
        <Center py={6}>
          <Spinner size="sm" />
        </Center>
      ) : null}
    </FeedLayout>
  )
}

export default MoviesPage
