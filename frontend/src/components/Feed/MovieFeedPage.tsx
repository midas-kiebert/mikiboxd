/**
 * A feed of films rather than screenings — the films tab, and the home feed
 * when "one row per film" is on.
 *
 * Same chrome as the showtime feed, different rows. **The column beside it is
 * the showtimes feed's own** — the shipped `ShowtimeDetailPanel` on the
 * screening you picked out of a row's plates, and `FeedOverviewPanel`
 * (invites, your plans, what friends are going to and the rest) while nothing
 * is picked. A film's own detail is still its own page — pressing a row, or
 * its "+N more" plate, is what takes you there — but pressing a *time* is
 * what lets this feed act on a screening at all: a card hands its film back
 * with it, and `ShowtimeInMoviePublic` + that film is exactly a
 * `ShowtimePublic`.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import type { MovieSummaryPublic, ShowtimePublic } from "shared"

import { useIsSignedIn } from "@/auth/useSession"
import FeedOverviewPanel from "@/components/Feed/FeedOverviewPanel"
import FeedPageShell, { type FeedChrome } from "@/components/Feed/FeedPageShell"
import {
  FEED_ITEM_CLASS,
  useFeedEntranceDelays,
} from "@/components/Feed/use-feed-entrance"
import FilmRow, { FILM_ROW_LAYOUT } from "@/components/Movies/cards/FilmRow"
import type { FilmTime } from "@/components/Movies/cards/film-card-kit"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import { useShowtimePanelSlot } from "@/features/showtimes/showtime-panel-slot"
import { FeedLinkParamsContext } from "@/features/showtimes/unfiltered-links"
import { useFeedOverview } from "@/features/showtimes/useFeedOverview"
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
  /** Replaces the empty message and its "Clear filters" outright. */
  emptyState?: ReactNode
  showPresets?: boolean
  showGroupToggle?: boolean
  /**
   * The page is about to be swapped for the other layout (ticket wall ↔ film
   * rows) and is only still here while that one renders — so it shows the
   * loading screen instead of rows that no longer answer the filters.
   */
  isSwitchingLayout?: boolean
}

/** The feed: one film to a row, at the measure `FilmRow` publishes. */
const ROW_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxWidth: FILM_ROW_LAYOUT.maxWidth,
  margin: "0 auto",
  gap: FILM_ROW_LAYOUT.gap,
}

/**
 * How far ahead of the end the next page is asked for — a share of the
 * scrolling column rather than a pixel count, same reasoning as the showtime
 * feed's `SCROLL_RUNWAY`: a fixed pixel margin means a different amount of
 * feed on every screen, so it runs out at an unpredictable point depending on
 * row height. Six screenfuls of runway keeps a request in flight long before
 * the last drawn row arrives, even on a fast scroll.
 */
const SCROLL_RUNWAY = "600%"

const MovieFeedPage = ({
  feed,
  header,
  emptyText = "No films showing.",
  filteredEmptyText = "No films match these filters.",
  emptyState,
  showPresets = true,
  showGroupToggle = false,
  isSwitchingLayout = false,
}: MovieFeedPageProps) => {
  /**
   * The screening the panel is open on — a real `ShowtimePublic`, built where
   * it is picked. `ShowtimeInMoviePublic` is one minus the film (it was listed
   * *under* the film, so it carries no copy of it) and the card handing it up
   * is the film, so the two make a whole one.
   */
  const [selected, setSelected] = useState<ShowtimePublic | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const isSignedIn = useIsSignedIn()

  useInfiniteScroll({
    fetchNextPage: feed.fetchNextPage,
    // Not mid-switch: the loading screen puts the sentinel in view, and the
    // feed being left would fetch page after page on its way out.
    hasNextPage: feed.hasNextPage && !isSwitchingLayout,
    isFetchingNextPage: feed.isFetchingNextPage,
    loadMoreRef,
    rootMargin: SCROLL_RUNWAY,
  })

  const handleSelectTime = useCallback(
    (movie: MovieSummaryPublic, time: FilmTime) => {
      setSelected((current) =>
        current?.id === time.id ? null : { ...time.showtime, movie },
      )
    },
    [],
  )

  const handleSelectShowtime = useCallback((showtime: ShowtimePublic) => {
    setSelected((current) => (current?.id === showtime.id ? null : showtime))
  }, [])

  const handleClose = useCallback(() => setSelected(null), [])

  // A notification's screening opens here too; the selection is a whole
  // showtime already, so it needs no film row to be found in.
  useShowtimePanelSlot(setSelected)

  // A plate is what opens a selection, so anything that isn't one closes it —
  // except the panel itself, whose own buttons (going, invite, seat map) have
  // to keep working without dismissing the thing they act on. A plate's own
  // click handler stops its propagation, so this never fights the toggle that
  // lets pressing the same plate again close the panel.
  useEffect(() => {
    if (!selected) return
    const handleOutsidePress = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      // The notification bell and panel too: they open screenings in this one.
      if (
        target?.closest(
          ".fc-plate, [data-feed-side-panel], [data-notification-centre]",
        )
      ) {
        return
      }
      handleClose()
    }
    document.addEventListener("mousedown", handleOutsidePress)
    return () => document.removeEventListener("mousedown", handleOutsidePress)
  }, [selected, handleClose])

  /**
   * The detail column, which is the showtimes feed's own: the shipped panel on
   * the screening you picked, and `FeedOverviewPanel` — invites, plans, what
   * friends are going to and the rest — while nothing is picked. The overview
   * holds still while a screening is open, as it does beside the showtimes.
   */
  const overview = useFeedOverview({
    feedParams: feed.params,
    enabled: isSignedIn,
    paused: selected !== null,
  })
  const detail = selected ? (
    <ShowtimeDetailPanel showtime={selected} onClose={handleClose} />
  ) : (
    <FeedOverviewPanel
      overview={isSignedIn ? overview : null}
      feedParams={feed.params}
      hasActiveFilters={
        feed.activeFilterCount > 0 || feed.params.q.trim() !== ""
      }
      onSelect={handleSelectShowtime}
      onApplyFilters={feed.applyParams}
    />
  )

  // Rows fade and lift in as they arrive, like the showtime feed's cards
  // (`use-feed-entrance`).
  const entranceDelays = useFeedEntranceDelays(
    feed.movies.map((movie) => movie.id),
  )

  // Owned here rather than left to the shell's default, because the rows
  // have to go with it: drawn under the loading screen, the film rows sat
  // there beneath the spinner while the ticket wall was being built.
  const isLoadingRows =
    isSwitchingLayout || feed.isLoading || feed.isReplacingRows

  return (
    // Film links in the list and the panel carry these filters with them.
    <FeedLinkParamsContext.Provider value={feed.params}>
      <FeedPageShell
        feed={feed}
        header={header}
        emptyText={emptyText}
        filteredEmptyText={filteredEmptyText}
        emptyState={emptyState}
        showPresets={showPresets}
        showGroupToggle={showGroupToggle}
        searchPlaceholder="Search films…"
        loadMoreRef={loadMoreRef}
        grid
        minListWidth={FILM_ROW_LAYOUT.minWidth}
        detail={detail}
        isLoadingRows={isLoadingRows}
      >
        <div style={ROW_STYLE}>
          {(isLoadingRows ? [] : feed.movies).map((movie) => {
            const delay = entranceDelays.get(movie.id) ?? 0
            return (
              <div
                key={movie.id}
                className={FEED_ITEM_CLASS}
                style={delay ? { animationDelay: `${delay}ms` } : undefined}
              >
                <FilmRow
                  movie={movie}
                  selectedTimeId={selected?.id ?? null}
                  onSelectTime={(time) => handleSelectTime(movie, time)}
                />
              </div>
            )
          })}
        </div>
      </FeedPageShell>
    </FeedLinkParamsContext.Provider>
  )
}

export default MovieFeedPage
