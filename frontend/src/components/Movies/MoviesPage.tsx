import { useMutation, useQueryClient } from "@tanstack/react-query"
/**
 * The films feed.
 *
 * Same chrome as every other feed; the rows are films. It used to carry its own
 * copy of the layout, toolbar and rail — that all lives in `FeedPageShell` now,
 * which is also what lets the home feed swap to this view for "one row per
 * film".
 *
 * The Letterboxd sync that fires on mount is members-only: a guest browsing
 * films used to send two 401s on arrival.
 */
import { useEffect, useRef } from "react"
import { MeService } from "shared"

import { useIsSignedIn } from "@/auth/useSession"
import MovieFeedPage from "@/components/Feed/MovieFeedPage"
import { useMoviesFeed } from "@/features/showtimes/useMoviesFeed"

const MoviesPage = () => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const feed = useMoviesFeed()
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const hasSynced = useRef(false)

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

  useEffect(() => {
    if (!isSignedIn || hasSynced.current) return
    syncWatchlist()
    syncWatched()
    hasSynced.current = true
  }, [isSignedIn, syncWatchlist, syncWatched])

  // Render/output using the state and derived values prepared above.
  return <MovieFeedPage feed={feed} />
}

export default MoviesPage
