/**
 * Activity: the app's Activity tab, on the web. Screenings you or your friends
 * are going to or interested in, in three slices — All, You, Friends — from
 * the same endpoints the app reads (`useActivityFeed`).
 *
 * Laid out as an agenda, not a wall. The ticket wall is for browsing — every
 * card competing for attention in a long grid — while this is a list you go
 * through, so it reads top to bottom as rows under day headings, the time
 * first on each (`ActivityRow`).
 *
 * The width, with no filter rail to share it with, is spent in three ways
 * rather than on longer lines:
 *
 *   - **The day sits in a gutter**, a calendar's date column pinned beside its
 *     rows as they scroll, instead of a heading line above them.
 *   - **Each row is a table line** — when, film, where, who — one fact per
 *     column, so the eye can run down any one of them. Friends are named
 *     rather than stacked, which is what the extra width buys a row.
 *   - **A docked side column**, the showtime panel's, reserved for good so
 *     picking a row never refolds the list. Empty, it summarises the list
 *     beside it (`ActivitySummary`).
 *
 * And the list itself stops at `LIST_MAX_WIDTH`: past that a row is not
 * clearer, only emptier, so the rest of a wide monitor is margin.
 */
import { Box, Center, Flex, Spinner, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { FiList, FiUserPlus } from "react-icons/fi"
import type { ShowtimePublic } from "shared"
import { MeService } from "shared/client"
import { useFetchFriends } from "shared/hooks/useFetchFriends"

import { DETAIL_WIDTH } from "@/components/Feed/FeedLayout"
import {
  FEED_ITEM_CLASS,
  useFeedEntranceDelays,
} from "@/components/Feed/use-feed-entrance"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import { PAGE_NOTICE_BANNER_OFFSET_CSS, TOP_NAV_HEIGHT } from "@/constants"
import { useDayClock } from "@/features/showtimes/day-clock"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import { useShowtimePanelSlot } from "@/features/showtimes/showtime-panel-slot"
import { useActivityFeed } from "@/features/showtimes/useActivityFeed"
import { useHeldShowtime } from "@/features/showtimes/useHeldShowtime"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { useIsMobile } from "@/hooks/useIsMobile"
import { Route } from "@/routes/_layout/activity"

import ActivityRow from "./ActivityRow"
import ActivitySummary from "./ActivitySummary"
import { groupByEvening } from "./activity-days"
import {
  ACTIVITY_MODES,
  type ActivityMode,
  DEFAULT_ACTIVITY_MODE,
} from "./activity-modes"

import "./activity.css"

/**
 * The list's widest. Enough for the four columns of a row to each hold their
 * fact on one line — a long title, a cinema tag and a room, two named friends —
 * beside the day gutter; wider only spreads the same facts further apart.
 */
const LIST_MAX_WIDTH = 1040
const COLUMN_GAP = 32
/** The widest the side column is ever asked to be (`DETAIL_WIDTH`'s `2xl`). */
const DETAIL_MAX_WIDTH = 520
const CONTENT_MAX_WIDTH = LIST_MAX_WIDTH + COLUMN_GAP + DETAIL_MAX_WIDTH

/**
 * Where the side column pins inside `_layout`'s scroller, and how tall it may
 * get: the viewport less the nav and the notice banner above the scroller.
 */
const PANEL_INSET = 20
const PANEL_MAX_HEIGHT = `calc(100dvh - ${PAGE_NOTICE_BANNER_OFFSET_CSS} - ${TOP_NAV_HEIGHT}px - ${
  2 * PANEL_INSET
}px)`

/** How far ahead of the end the next page is asked for, in screenfuls. */
const SCROLL_RUNWAY = "300%"

const Row = memo(ActivityRow)

const ActivityPage = () => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = Route.useSearch() as { mode?: ActivityMode }
  const mode = search.mode ?? DEFAULT_ACTIVITY_MODE
  const feed = useActivityFeed(mode)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const reference = useDayClock()

  // Only needed to tell "no friends yet" from "friends, but nothing on".
  const { data: friends, isLoading: isLoadingFriends } = useFetchFriends({
    enabled: mode !== "you",
  })
  const hasFriends = (friends?.length ?? 0) > 0

  // Viewing "You" is what clears the invite badge, as in the app.
  const { mutate: markInvitesSeen } = useMutation({
    mutationFn: () => MeService.markMyShowtimePingsSeen(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] })
      queryClient.invalidateQueries({
        queryKey: ["me", "notifications", "unseenCount"],
      })
    },
  })
  useEffect(() => {
    if (mode === "you") markInvitesSeen()
  }, [mode, markInvitesSeen])

  useInfiniteScroll({
    fetchNextPage: feed.fetchNextPage,
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    loadMoreRef,
    rootMargin: SCROLL_RUNWAY,
  })

  const setMode = (next: ActivityMode) => {
    setSelectedId(null)
    void navigate({
      to: "/activity",
      search: next === DEFAULT_ACTIVITY_MODE ? {} : { mode: next },
      replace: true,
    } as never)
  }

  // Held as an id and looked up in the rows, so the panel always shows the
  // row as the cache has it now — a status press patches the row, not the
  // copy that was clicked. Also held apart from the list (`useHeldShowtime`):
  // taking your status back takes the row off the list at once, and the panel
  // stays open on it — still live — so you can change your mind. The same
  // copy serves a screening opened from the side column that is not loaded.
  const { held, hold } = useHeldShowtime()
  const inList =
    feed.showtimes.find((showtime) => showtime.id === selectedId) ?? null
  const selected = inList ?? (held && held.id === selectedId ? held : null)
  useEffect(() => {
    if (selectedId !== null && !selected && !feed.isLoading) setSelectedId(null)
  }, [selectedId, selected, feed.isLoading])

  const handleSelect = useCallback(
    (showtime: ShowtimePublic) => {
      hold(showtime)
      setSelectedId((current) => (current === showtime.id ? null : showtime.id))
    },
    [hold],
  )
  const handleClose = useCallback(() => setSelectedId(null), [])

  // A notification's screening opens here, held like one from the side column.
  const openFromElsewhere = useCallback(
    (showtime: ShowtimePublic) => {
      hold(showtime)
      setSelectedId(showtime.id)
    },
    [hold],
  )
  useShowtimePanelSlot(openFromElsewhere)

  useEffect(() => {
    if (selectedId === null) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [selectedId])

  // The panel follows a render behind the selection, so the row's own ring
  // paints on the click; same split as the feed's.
  const panelShowtime = useDeferredValue(selected)
  const panel = useMemo(
    () =>
      panelShowtime ? (
        <ShowtimeDetailPanel showtime={panelShowtime} onClose={handleClose} />
      ) : null,
    [panelShowtime, handleClose],
  )

  const days = useMemo(
    () => groupByEvening(feed.showtimes, reference),
    [feed.showtimes, reference],
  )
  // The server's count for each day, over the whole list — not the rows loaded
  // so far, which would climb as the list scrolls.
  const dayCounts = useMemo(
    () =>
      new Map(feed.summary?.days.map(({ day, count }) => [day, count]) ?? []),
    [feed.summary],
  )
  const entranceDelays = useFeedEntranceDelays(
    feed.showtimes.map((showtime) => showtime.id),
  )
  const current =
    ACTIVITY_MODES.find((option) => option.value === mode) ?? ACTIVITY_MODES[0]

  // Render/output using the state and derived values prepared above.
  return (
    <Box
      px={{ base: 3, md: 8, xl: 12, "2xl": 16 }}
      pt={{ base: 4, md: 8 }}
      pb={16}
    >
      <Flex
        maxW={`${CONTENT_MAX_WIDTH}px`}
        mx="auto"
        align="flex-start"
        justify="center"
        gap={`${COLUMN_GAP}px`}
      >
        <Box flex="1 1 auto" minW={0} maxW={`${LIST_MAX_WIDTH}px`}>
          <header className="ac-head">
            <div className="ac-head__titles">
              <h1 className="ac-head__title">Activity</h1>
              <p className="ac-head__description">{current.description}</p>
            </div>
            <div
              className="ac-modes"
              role="tablist"
              aria-label="Whose activity"
            >
              {ACTIVITY_MODES.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={option.value === mode}
                    className="ac-modes__option"
                    onClick={() => setMode(option.value)}
                  >
                    <Icon className="ac-modes__icon" aria-hidden />
                    <span className="ac-modes__label">{option.label}</span>
                  </button>
                )
              })}
            </div>
          </header>

          {feed.isLoading ? (
            <Center py={24}>
              <Spinner size="lg" color="app.tint" />
            </Center>
          ) : feed.isError ? (
            <Center py={24}>
              <Text color="fg.muted">
                Activity could not be loaded. Try again in a moment.
              </Text>
            </Center>
          ) : feed.isEmpty ? (
            <EmptyActivity
              mode={mode}
              hasFriends={hasFriends}
              isLoadingFriends={isLoadingFriends}
            />
          ) : (
            <div className="ac-days">
              {/* On a phone the panel opens under its row; one whose row has
                  just left the list stays open up here instead. */}
              {isMobile && selected && !inList ? (
                <Box pb={4}>
                  <ShowtimeDetailPanel
                    showtime={selected}
                    onClose={handleClose}
                  />
                </Box>
              ) : null}
              {days.map((day) => (
                <section
                  key={day.key}
                  className="ac-day"
                  aria-label={day.label}
                >
                  <div className="ac-day__gutter">
                    <span
                      className={`ac-day__label${
                        day.weekday ? " ac-day__label--relative" : ""
                      }`}
                    >
                      {day.label}
                    </span>
                    <span className="ac-day__date">
                      <span className="ac-day__num">{day.dayOfMonth}</span>
                      <span className="ac-day__month">{day.month}</span>
                    </span>
                    {day.weekday ? (
                      <span className="ac-day__weekday">{day.weekday}</span>
                    ) : null}
                    <DayCount count={dayCounts.get(day.day)} />
                  </div>

                  <div className="ac-rows">
                    {day.showtimes.map((showtime) => {
                      const delay = entranceDelays.get(showtime.id) ?? 0
                      return (
                        <div
                          key={showtime.id}
                          className={`ac-rows__item ${FEED_ITEM_CLASS}`}
                          style={
                            delay ? { animationDelay: `${delay}ms` } : undefined
                          }
                        >
                          <Row
                            showtime={showtime}
                            isSelected={showtime.id === selectedId}
                            onSelect={handleSelect}
                          />
                          {/* No room to dock on a phone: the panel opens
                              under the row it belongs to. */}
                          {isMobile && selected?.id === showtime.id ? (
                            <Box py={2}>
                              <ShowtimeDetailPanel
                                showtime={selected}
                                onClose={handleClose}
                              />
                            </Box>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}

              <div ref={loadMoreRef} aria-hidden />
              {feed.isFetchingNextPage ? (
                <Center py={6}>
                  <Spinner size="md" color="app.tint" />
                </Center>
              ) : null}
              {!feed.hasNextPage && feed.showtimes.length > 0 ? (
                <p className="ac-end">That's everything coming up.</p>
              ) : null}
            </div>
          )}
        </Box>

        {isMobile ? null : (
          <Box
            as="aside"
            // `SIDE_PANEL_SCROLLER_ATTRIBUTE`: what the panel looks for when
            // it scrolls itself back to the top on a new screening.
            data-feed-side-panel=""
            w={DETAIL_WIDTH}
            flexShrink={0}
            position="sticky"
            top={`${PANEL_INSET}px`}
            maxH={PANEL_MAX_HEIGHT}
            overflowY="auto"
            overscrollBehavior="contain"
          >
            {panel ?? (
              <ActivitySummary
                mode={mode}
                summary={feed.summary}
                onSelect={handleSelect}
              />
            )}
          </Box>
        )}
      </Flex>
    </Box>
  )
}

/** "3 screenings", once the server has counted the day; nothing until then. */
const DayCount = ({ count }: { count: number | undefined }) =>
  count === undefined ? null : (
    <span className="ac-day__count">
      {count} {count === 1 ? "screening" : "screenings"}
    </span>
  )

/**
 * The app's empty states, in its words: what is missing, and the one or two
 * things that would fill it.
 */
const EmptyActivity = ({
  mode,
  hasFriends,
  isLoadingFriends,
}: {
  mode: ActivityMode
  hasFriends: boolean
  isLoadingFriends: boolean
}) => {
  const isYou = mode === "you"
  const title = isYou
    ? "Nothing in your agenda yet"
    : hasFriends
      ? "Nothing lined up right now"
      : "No friends yet"
  const body = isYou
    ? "See what's playing and mark something you're going to."
    : hasFriends
      ? "Nobody's marked a screening going or interested yet."
      : "Add friends to see what they're going to."

  const browse = (
    <Link
      to="/"
      search={defaultFeedParams as never}
      className="ac-empty__action"
    >
      <FiList aria-hidden />
      <span className="ac-empty__action-label">Browse showtimes</span>
    </Link>
  )
  const addFriends = (
    <Link
      to="/friends"
      search={{ mode: "discover" } as never}
      className="ac-empty__action"
    >
      <FiUserPlus aria-hidden />
      <span className="ac-empty__action-label">Add friends</span>
    </Link>
  )

  return (
    <div className="ac-empty">
      <p className="ac-empty__title">{title}</p>
      {!isYou && isLoadingFriends ? null : (
        <>
          <p className="ac-empty__body">{body}</p>
          <div className="ac-empty__actions">
            {isYou || mode === "all" ? browse : null}
            {isYou ? null : addFriends}
          </div>
        </>
      )}
    </div>
  )
}

export default ActivityPage
