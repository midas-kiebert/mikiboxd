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
import { useQueryClient } from "@tanstack/react-query"
import { useDeferredValue, useEffect } from "react"

import FeedSubjectHeader, {
  useFeedSubject,
  useNonFriendEmptyState,
} from "@/components/Feed/FeedSubjectHeader"
import MovieFeedPage from "@/components/Feed/MovieFeedPage"
import ShowtimeFeedPage from "@/components/Feed/ShowtimeFeedPage"
import { useFeedParams } from "@/features/showtimes/useFeedParams"
import { useMoviesFeed } from "@/features/showtimes/useMoviesFeed"
import { useShowtimesFeed } from "@/features/showtimes/useShowtimesFeed"

const MainShowtimesPage = () => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  // One filter state for the page and both feeds. Each feed used to keep its
  // own, and the page read the URL: a change that flips grouping (the
  // overview's "Show more") landed in the visible feed at once but reached the
  // page only with the URL, 300-500ms later — so the film rows sat there
  // meanwhile, redrawn for the *new* filters, and flashed up whenever those
  // were cached, before the ticket wall took over.
  const feedState = useFeedParams()
  const isGrouped = feedState.params.group
  // The layout on screen follows a render behind. Swapping it rebuilds the
  // whole page — rail, shell and every row — and done in the click's own
  // render that froze the page with nothing to show for it. So the page on
  // screen first drops to its loading screen (cheap, and painted at once),
  // and the other layout is built from this deferred copy, where React can
  // yield — the way a filter change inside the ticket wall already works.
  // The feeds switch on the real flag, so the new one's request starts now.
  const shownGrouped = useDeferredValue(isGrouped)
  const isSwitchingLayout = shownGrouped !== isGrouped

  // The feed left behind is forgotten, not kept: coming back to it then opens
  // on a fresh first page instead of every page scrolled through last time,
  // which it rendered (and refetched) all at once — switching back was slow.
  // Only the now-disabled feed's queries are inactive, so nothing on screen
  // loses its data.
  const queryClient = useQueryClient()
  useEffect(() => {
    if (isSwitchingLayout) return
    queryClient.removeQueries({
      queryKey: isGrouped ? ["showtimes", "main"] : ["movies"],
      type: "inactive",
    })
  }, [isGrouped, isSwitchingLayout, queryClient])
  // One friend or one cinema: the page each used to be — see `FeedSubjectHeader`.
  const subject = useFeedSubject(feedState.params)
  const header = subject ? (
    <FeedSubjectHeader subject={subject} onChange={feedState.setParams} />
  ) : undefined
  // Said the way the friend's agenda page said it, which is what this is.
  // Said the way the friend's agenda page said it, which is what this is.
  const friendsEmptyText = feedState.params.friends.length
    ? feedState.params.friends.length === 1
      ? "Nothing coming up that this friend shares with you."
      : "Nothing coming up that these friends share with you."
    : undefined
  // Someone who isn't a friend: why it's empty, and how to change that.
  const nonFriendEmptyState = useNonFriendEmptyState(subject)

  const showtimesFeed = useShowtimesFeed({ enabled: !isGrouped, feedState })
  // Ten is the API's ceiling (`showtime_limit`, `le=10`); the row has six
  // plate slots and a "+N more" tile past that, so it asks for all it can get.
  const moviesFeed = useMoviesFeed({
    enabled: isGrouped,
    showtimeLimit: 10,
    feedState,
  })

  // Render/output using the state and derived values prepared above.
  if (shownGrouped) {
    return (
      <MovieFeedPage
        feed={moviesFeed}
        showGroupToggle
        header={header}
        emptyState={nonFriendEmptyState}
        isSwitchingLayout={isSwitchingLayout}
        emptyText="No films showing."
        filteredEmptyText={friendsEmptyText ?? "No films match these filters."}
      />
    )
  }

  return (
    <ShowtimeFeedPage
      feed={showtimesFeed}
      showGroupToggle
      header={header}
      filteredEmptyText={friendsEmptyText}
      emptyState={nonFriendEmptyState}
      overviewFiltersInPlace
      isSwitchingLayout={isSwitchingLayout}
    />
  )
}

export default MainShowtimesPage
