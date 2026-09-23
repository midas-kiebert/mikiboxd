/**
 * The Activity page's rows: the same two queries the app's Activity tab runs,
 * with the same arguments (`mobile/app/(tabs)/activity.tsx`).
 *
 *   All / Friends — the main-page showtimes, narrowed to screenings someone
 *   marked going or interested. `allCinemas` because activity is about
 *   people, not about the viewer's cinemas (`_skips_cinema_default` in
 *   `backend/app/services/viewer_context.py`); `friendsOnly` drops the
 *   viewer's own marks for "Friends".
 *   You — `/me/agenda` with interested and invites folded in: an invite is
 *   relevant to you by definition, so there is no toggle for it.
 *
 * Both hooks are called and one is left disabled, since hooks cannot be
 * conditional; switching mode flips which one runs, and the other keeps its
 * cache for the way back.
 *
 * Beside the rows, the summary (`GET /me/activity/summary`): per-day counts,
 * your plans, invites and the friend ranking, counted by the server over the
 * whole list at the same snapshot — so no number on the page grows as more
 * pages load.
 *
 * The rows are the server's, less any that stopped belonging on this list
 * since it sent them (`belongsToActivity`): a status you take back takes the
 * row with it at once, rather than on the next fetch.
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import type { GoingStatus, ShowtimePublic } from "shared"
import { MeService } from "shared/client"
import { useFetchAgenda } from "shared/hooks/useFetchAgenda"
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes"

import type { ActivityMode } from "@/components/Activity/activity-modes"

import { buildSnapshotTime } from "./useFeedParams"

/** Both statuses: this is "who's doing something about this screening". */
const ACTIVITY_STATUSES: GoingStatus[] = ["GOING", "INTERESTED"]

/**
 * Whether a row still belongs on a mode's list, by the server's own rules:
 * the viewer's going/interested or an open invite for You; a friend's
 * going/interested for Friends; either for All.
 *
 * Read off the row as the cache has it now, which a status press patches
 * immediately — so the row leaves the list on the press, and the refetch that
 * follows (`refetchStatusScopedFeeds`) only confirms it.
 */
export const belongsToActivity = (
  showtime: ShowtimePublic,
  mode: ActivityMode,
): boolean => {
  const viewer = showtime.viewer
  const isOwnPlan = viewer?.going === "GOING" || viewer?.going === "INTERESTED"
  const hasFriends =
    (viewer?.friends_going?.length ?? 0) +
      (viewer?.friends_interested?.length ?? 0) >
    0
  if (mode === "you") return isOwnPlan || (viewer?.invited_by?.length ?? 0) > 0
  if (mode === "friends") return hasFriends
  return isOwnPlan || hasFriends
}

/** Same paging as the web's other feeds: a short first page, longer after. */
const FIRST_PAGE_LIMIT = 20
const PAGE_LIMIT = 40

export const useActivityFeed = (mode: ActivityMode) => {
  const isYou = mode === "you"
  // One "now" for the life of the page, so later pages cannot drift past the
  // first one. Shared by both queries: switching mode is not a refresh.
  const [snapshotTime] = useState(buildSnapshotTime)

  const filters = useMemo(
    () => ({
      selectedStatuses: ACTIVITY_STATUSES,
      friendsOnly: mode === "friends",
      allCinemas: true,
    }),
    [mode],
  )

  const mainQuery = useFetchMainPageShowtimes({
    limit: PAGE_LIMIT,
    firstPageLimit: FIRST_PAGE_LIMIT,
    snapshotTime,
    filters,
    enabled: !isYou,
  })

  const agendaQuery = useFetchAgenda({
    limit: PAGE_LIMIT,
    firstPageLimit: FIRST_PAGE_LIMIT,
    snapshotTime,
    includeInterested: true,
    includeInvited: true,
    enabled: isYou,
  })

  const summaryQuery = useQuery({
    // Under `showtimes`, and in `STATUS_SCOPED_FEED_KEYS`: a status press
    // changes these counts, so it refetches them.
    queryKey: ["showtimes", "activity-summary", mode, snapshotTime],
    queryFn: () => MeService.getActivitySummary({ mode, snapshotTime }),
    staleTime: 30_000,
  })

  const query = isYou ? agendaQuery : mainQuery
  const showtimes = useMemo(
    () =>
      (query.data?.pages.flat() ?? []).filter((showtime) =>
        belongsToActivity(showtime, mode),
      ),
    [query.data, mode],
  )

  return {
    showtimes,
    summary: summaryQuery.data ?? null,
    // `isPending`, not `isLoading`: see `useShowtimesFeed`.
    isLoading: query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isEmpty: !query.isPending && showtimes.length === 0,
    isError: query.isError,
  }
}

export type ActivityFeed = ReturnType<typeof useActivityFeed>
