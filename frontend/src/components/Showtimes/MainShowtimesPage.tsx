/**
 * The website's home feed.
 *
 * It used to be hardcoded to the viewer's own going + interested showtimes, so
 * a signed-in visitor with an empty agenda got an empty homepage and there was
 * no way to browse the programme at all. It now defaults to everything.
 *
 * "One row per film" is not a filter argument — it swaps which endpoint the
 * page reads, exactly as the app does, and renders film rows instead of
 * screenings. Hooks cannot be conditional, so both run and `enabled` decides
 * which one actually fetches.
 */
import MovieFeedPage from "@/components/Feed/MovieFeedPage"
import ShowtimeFeedPage from "@/components/Feed/ShowtimeFeedPage"
import { useFeedParams } from "@/features/showtimes/useFeedParams"
import { useMoviesFeed } from "@/features/showtimes/useMoviesFeed"
import { useShowtimesFeed } from "@/features/showtimes/useShowtimesFeed"

const MainShowtimesPage = () => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  // Read the flag straight off the URL rather than from either feed, so neither
  // has to be running to decide which one should be.
  const { params } = useFeedParams()
  const isGrouped = params.group

  const showtimesFeed = useShowtimesFeed({ enabled: !isGrouped })
  const moviesFeed = useMoviesFeed({ enabled: isGrouped })

  // Render/output using the state and derived values prepared above.
  if (isGrouped) {
    return (
      <MovieFeedPage
        feed={moviesFeed}
        showGroupToggle
        emptyText="No films showing."
        filteredEmptyText="No films match these filters."
      />
    )
  }

  return <ShowtimeFeedPage feed={showtimesFeed} showGroupToggle />
}

export default MainShowtimesPage
