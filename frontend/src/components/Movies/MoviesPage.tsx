import Page from "@/components/Common/Page"
import Movies from "@/components/Movies/Movies"
import MoviesTopBar from "@/components/Movies/MoviesTopBar"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { Center, Flex, Spinner } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
/**
 * Movies list feature component: Movies Page.
 */
import { getRouteApi } from "@tanstack/react-router"
import { DateTime } from "luxon"
import { useEffect, useRef, useState } from "react"
import { MeService } from "shared"
import { useFetchMovies } from "shared/hooks/useFetchMovies"
import type { MovieFilters } from "shared/hooks/useFetchMovies"
import { useDebounce } from "use-debounce"

type MoviesSearchParams = {
  query: string
  watchlistOnly: boolean
  days: string[]
}

const moviesRoute = getRouteApi("/_layout/movies")

const MoviesPage = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const limit = 15
  // Keep one fixed snapshot timestamp so pagination pages stay consistent while scrolling.
  const [snapshotTime] = useState(() =>
    DateTime.now()
      .setZone("Europe/Amsterdam")
      .toFormat("yyyy-MM-dd'T'HH:mm:ss"),
  )
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const search = moviesRoute.useSearch() as MoviesSearchParams
  const navigate = moviesRoute.useNavigate()
  const [searchQuery, setSearchQuery] = useState<string>(search.query ?? "")
  const [debouncedSearchQuery] = useDebounce(searchQuery, 250)
  const [watchlistOnly, setWatchlistOnly] = useState<boolean>(
    search.watchlistOnly,
  )
  // Convert URL string days to Date objects for the DayFilter
  const selectedDays = search.days.map((d: string) =>
    DateTime.fromISO(d).toJSDate(),
  )

  const handleDaysChange = (days: Date[]) => {
    // Convert Date objects to ISO strings for the URL
    const isoDays = days.map((d: Date) => DateTime.fromJSDate(d).toISODate())
    navigate({
      search: {
        query: searchQuery,
        watchlistOnly,
        days: isoDays,
      },
      replace: true,
    })
  }

  const queryClient = useQueryClient()

  // Data hooks keep this module synced with backend data and shared cache state.
  const { mutate: fetchWatchlist } = useMutation({
    mutationFn: () => MeService.syncWatchlist(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["movies"] })
    },
  })

  // Sync watchlist once on initial mount so server watchlist state is current.
  const hasFetched = useRef(false)

  useEffect(() => {
    if (hasFetched.current) return
    fetchWatchlist()
    hasFetched.current = true
  }, [])

  // Persist search/filter state into the URL so refresh/share keeps the same view.
  useEffect(() => {
    const isSame =
      search.query === debouncedSearchQuery &&
      search.watchlistOnly === watchlistOnly
    if (isSame) return
    navigate({
      search: {
        query: debouncedSearchQuery,
        watchlistOnly: watchlistOnly,
        days: search.days,
      },
      replace: true,
    })
  }, [debouncedSearchQuery, watchlistOnly, navigate])

  // The fetch hook uses these filters as part of its query key.
  const filters: MovieFilters = {
    query: debouncedSearchQuery,
    watchlistOnly: watchlistOnly,
    days: selectedDays.map((d: Date) =>
      DateTime.fromJSDate(d).toISODate() || "",
    ),
  }

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useFetchMovies({
    limit: limit,
    snapshotTime,
    filters,
  })

  useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    loadMoreRef,
    // Start prefetching before the user reaches the bottom for smoother infinite scroll.
    rootMargin: "2000px",
  })

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <Flex>
        <MoviesTopBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          watchlistOnly={watchlistOnly}
          setWatchlistOnly={setWatchlistOnly}
          selectedDays={selectedDays}
          handleDaysChange={handleDaysChange}
        />
      </Flex>
      <Page>
        <Movies
          movies={data?.pages.flat() || []}
          isLoading={(isLoading || isFetching) && !isFetchingNextPage}
        />
        {hasNextPage && <div ref={loadMoreRef} style={{ height: "1px" }} />}
        {isFetchingNextPage && (
          <Center mt={4}>
            <Spinner size="lg" />
          </Center>
        )}
      </Page>
    </>
  )
}

export default MoviesPage
