import { Box, Grid } from "@chakra-ui/react"
import { useNavigate } from "@tanstack/react-router"
/**
 * Every showtime feed on the website: home, a cinema's programme, your agenda,
 * a friend's agenda. They differ only in where their rows come from and what
 * they say when empty.
 *
 * Owns which showtime is selected; everything around the rows is
 * `FeedPageShell`.
 *
 * The rows are detached cards: a wall of upright tickets
 * (`Showtimes/cards/PortraitTicketCard`), two to four a row as the reader
 * picks under the filter rail (`WallColumnsControl`), or five with the rail
 * folded. Where the window is too
 * narrow for that many the row drops tickets, down to one; too narrow for even
 * one beside the rail and the detail column, and the rail folds to its strip
 * (`FeedLayout`'s `minListWidth`) — the detail column never gives way, since
 * the showtime panel opens in it.
 *
 * A click has to feel instant, and the panel it opens is not cheap to render.
 * So the two are split across frames: the selection ring is urgent and paints
 * on the click, and the panel renders from a deferred copy of the selection
 * straight after, where React can yield rather than hold the click's frame.
 * Everything handed to the cards is stable, so of a page of memoised cards
 * only the two whose selection changed re-render.
 *
 * The detail column stays reserved rather than opening and closing, because
 * anything that resizes moves every ticket; while nothing is selected it
 * shows `FeedOverviewPanel` there instead of leaving it empty.
 *
 * Rows arriving from the next page are rendered the same way. The query hands
 * a new page over synchronously, and twenty cards committed in one go were a
 * long task landing mid-scroll; from a deferred copy of the list React builds
 * them between frames instead, and the scroll keeps its pace.
 */
import {
  type CSSProperties,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import type { ShowtimePublic } from "shared"

import { useIsSignedIn } from "@/auth/useSession"
import FeedOverviewPanel from "@/components/Feed/FeedOverviewPanel"
import FeedPageShell, { type FeedChrome } from "@/components/Feed/FeedPageShell"
import { useIsRailFolded } from "@/components/Feed/RailCollapse"
import WallColumnsControl from "@/components/Feed/WallColumnsControl"
import {
  FEED_ITEM_CLASS,
  useFeedEntranceDelays,
} from "@/components/Feed/use-feed-entrance"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import PortraitTicketCard, {
  PORTRAIT_MIN_COLUMN_WIDTH,
} from "@/components/Showtimes/cards/PortraitTicketCard"
import {
  type FeedParams,
  stripDefaultFeedParams,
} from "@/features/showtimes/feed-params"
import { useShowtimePanelSlot } from "@/features/showtimes/showtime-panel-slot"
import {
  effectiveWallColumns,
  useWallColumns,
} from "@/features/showtimes/use-wall-columns"
import { useFeedOverview } from "@/features/showtimes/useFeedOverview"
import { useHeldShowtime } from "@/features/showtimes/useHeldShowtime"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { useIsMobile } from "@/hooks/useIsMobile"

/** Set on the wall by `TicketWall`: how many tickets a row it is drawing. */
const COLUMNS_VAR = "--mk-wall-columns"
/** And the space between tickets and at the wall's sides, which grow with them. */
const GAP_VAR = "--mk-wall-gap"
const MARGIN_VAR = "--mk-wall-margin"

/**
 * The room at stake: the wall's width over the tickets a row, before any gap
 * or margin comes out of it. `100cqw` is the wall's width, from the container
 * `TicketWall` wraps it in.
 */
const TICKET_SHARE = `(100cqw / var(${COLUMNS_VAR}))`

/**
 * Space between tickets: the default wall's 12px while tickets are that size
 * — four a row beside an open rail, on a 1920 screen about 220px of room
 * each — and growing with every pixel of room past it, so bigger tickets get
 * proportionally more air instead of standing shoulder to shoulder.
 */
const GAP_BASE_PX = 12
const GAP_FROM_SHARE_PX = 240
const GAP_PER_EXTRA = 0.07
const GAP_MAX_PX = 48
const WALL_GAP = `min(${GAP_MAX_PX}px, ${GAP_BASE_PX}px + max(0px, ${TICKET_SHARE} - ${GAP_FROM_SHARE_PX}px) * ${GAP_PER_EXTRA})`

/**
 * Between rows, the same 12px on the default wall but only a share of the
 * growth: a ticket is half again as tall as it is wide, so it already reads
 * as its own column, and gaps as wide vertically as across left big tickets
 * floating apart down the page.
 */
const ROW_GAP_VAR = "--mk-wall-row-gap"
const ROW_GAP_SHARE_OF_GROWTH = 0.3
const WALL_ROW_GAP = `calc(${GAP_BASE_PX}px + (var(${GAP_VAR}) - ${GAP_BASE_PX}px) * ${ROW_GAP_SHARE_OF_GROWTH})`

/**
 * And at the wall's sides, once each ticket has more room than a ticket
 * wants: past `COMFORTABLE_SHARE_PX` a share of every extra pixel, for every
 * ticket in the row, goes to the margins instead of the posters — so two a
 * row on a wide screen is two tickets with the wall drawn in around them, not
 * two posters the size of the window. Nothing at all below it, where the
 * tickets need every pixel.
 */
const COMFORTABLE_SHARE_PX = 360
const MARGIN_PER_EXTRA = 0.4
const WALL_MARGIN = `max(0px, (${TICKET_SHARE} - ${COMFORTABLE_SHARE_PX}px) * var(${COLUMNS_VAR}) * ${MARGIN_PER_EXTRA})`

/**
 * Memoised: the feed owns the selection, so every click re-renders the list,
 * and only the rows whose props changed should follow it.
 */
const Card = memo(PortraitTicketCard)

/** A stable empty list, so forcing `rows` to it while loading is one reference. */
const NO_SHOWTIMES: ShowtimePublic[] = []

/**
 * How far ahead of the end the next page is asked for.
 *
 * A share of the scrolling column rather than a pixel count, because a pixel
 * count means something different on every screen: the 400px this used to be
 * was most of a phone's screen but a third of a row on a wall of tickets, so
 * the feed ran out exactly where the cards are smallest and the scroll is
 * fastest. Six columns of runway is far enough ahead that a request is in
 * flight long before the last drawn card arrives, even on a fast scroll.
 *
 * The observer re-arms when a page lands (see `useInfiniteScroll`), so this is
 * also how much unseen feed is kept buffered: pages keep arriving until the
 * end of the list is this far away again, rather than one page per sighting.
 */
const SCROLL_RUNWAY = "600%"

/**
 * Roughly how tall a ticket is, for the space an off-screen card holds before
 * it has ever been drawn. Once drawn, the browser remembers the real size.
 *
 * The ticket is its poster (2:3, so 1.5× the column) plus the poster's inset
 * and the stub's fixed-height rows (`PortraitTicketCard.css`), which grow a
 * little with the ticket.
 * The column depends on how many tickets a row the reader picked, so this is
 * worked out in CSS against the wall's own width (it is a size container)
 * and the column count it publishes — one number cannot fit two to five.
 */
const POSTER_HEIGHT_PER_WIDTH = 1.5
/** The poster's inset; the rest of the fixed part is the stub. */
const TICKET_INSET_HEIGHT = 16
/** The stub, in the ticket's own pixels (`--mk-u`, PortraitTicketCard.css). */
const TICKET_STUB_UNITS = 88
// Floored at a ticket's minimum: below it the row has dropped a ticket, and
// the ones left are about that wide rather than a share of the chosen count.
const TICKET_WIDTH = `max(${PORTRAIT_MIN_COLUMN_WIDTH}px, (100cqw - 2 * var(${MARGIN_VAR}) - (var(${COLUMNS_VAR}) - 1) * var(${GAP_VAR})) / var(${COLUMNS_VAR}))`
/** `--mk-u` again, from out here: the card's own copy only resolves inside it. */
const TICKET_UNIT = `clamp(1px, 1px + (${TICKET_WIDTH} - 210px) * 0.00167, 1.4px)`
const CARD_INTRINSIC_HEIGHT = `calc(${TICKET_INSET_HEIGHT}px + ${TICKET_STUB_UNITS} * ${TICKET_UNIT} + ${POSTER_HEIGHT_PER_WIDTH} * ${TICKET_WIDTH})`

/**
 * Each card sits in a cell the browser may skip entirely while it is off
 * screen: no style, layout or paint for the hundreds of cards an infinite
 * feed has scrolled past or not reached. `content-visibility` also clips to
 * the cell, so the cell reaches `CELL_BLEED` past the card on every side —
 * room for the hover lift and its shadow — and takes it back with a negative
 * margin so the grid's spacing is unchanged. That makes neighbouring cells
 * overlap by their bleed, so a cell ignores the pointer and only the card in
 * it takes it (`TicketRoot` turns it back on).
 *
 * A plain `div` with one shared style object, because this wrapper renders
 * once per card on every render of the page and a styled component would
 * resolve its styles each time.
 */
const CELL_BLEED = 24
const CELL_STYLE: CSSProperties = {
  contentVisibility: "auto",
  // The card's own height, not the cell's: `contain-intrinsic-size` sizes
  // the content box and the bleed is padding on top of it. Counted in here
  // too, every card not yet drawn stood 48px too tall, and the page shrank
  // under the reader as each one reached the screen — the jump at the foot
  // of the feed whenever a page landed.
  containIntrinsicSize: `auto ${CARD_INTRINSIC_HEIGHT}`,
  padding: CELL_BLEED,
  margin: -CELL_BLEED,
  minWidth: 0,
  pointerEvents: "none",
}

/** Under the filter rail: full beside the rail, compact in its folded strip. */
const renderWallColumnsControl = (variant: "full" | "compact") => (
  <WallColumnsControl compact={variant === "compact"} />
)

/**
 * The grid itself, apart from the page because it has to sit inside
 * `FeedLayout` to know whether the rail beside it is folded — the room that
 * gives back is where a fifth ticket a row comes from.
 */
const TicketWall = ({ children }: { children: ReactNode }) => {
  const columns = effectiveWallColumns(useWallColumns(), useIsRailFolded())
  return (
    // The size container every width in here is measured from — the gap, the
    // margins, the columns, an undrawn cell's height (`CARD_INTRINSIC_HEIGHT`)
    // — with the column count, the gap and the margin published on it. A wrapper rather than the
    // grid itself, because a container's own `gap` cannot be sized from
    // its own width.
    <Box
      css={{
        containerType: "inline-size",
        [COLUMNS_VAR]: String(columns),
        [GAP_VAR]: WALL_GAP,
        [ROW_GAP_VAR]: WALL_ROW_GAP,
        [MARGIN_VAR]: WALL_MARGIN,
      }}
    >
      <Grid
        // The reader's number of tickets a row (`useWallColumns`), each one a
        // share of the width, so the tickets grow and shrink with the choice.
        // Where a ticket's minimum width no longer fits that many, the row
        // drops tickets, down to one.
        templateColumns={`repeat(auto-fill, minmax(max(${PORTRAIT_MIN_COLUMN_WIDTH}px, calc((100% - ${
          columns - 1
        } * var(${GAP_VAR})) / ${columns})), 1fr))`}
        columnGap={`var(${GAP_VAR})`}
        rowGap={`var(${ROW_GAP_VAR})`}
        px={`var(${MARGIN_VAR})`}
        pb={`var(${ROW_GAP_VAR})`}
      >
        {children}
      </Grid>
    </Box>
  )
}

/** What every showtime feed hook in `features/showtimes` returns. */
export type ShowtimeFeedLike = FeedChrome & {
  showtimes: ShowtimePublic[]
  fetchNextPage: () => void
  /** Which filters `showtimes` answers; see `useFeedParams`. */
  filtersKey: string
}

type ShowtimeFeedPageProps = {
  feed: ShowtimeFeedLike
  header?: ReactNode
  emptyText?: string
  filteredEmptyText?: string
  /** Replaces the empty message and its "Clear filters" outright. */
  emptyState?: ReactNode
  hasNav?: boolean
  showRail?: boolean
  showPresets?: boolean
  showGroupToggle?: boolean
  /**
   * The page is about to be swapped for the other layout (ticket wall ↔ film
   * rows) and is only still here while that one renders — so it shows the
   * loading screen instead of rows that no longer answer the filters.
   */
  isSwitchingLayout?: boolean
  /**
   * Whether the overview's "Show more" puts its filters on *this* feed. Only
   * the home feed: a page that pins something (a cinema, a friend's agenda)
   * would bend the list's filters around its own, so from there "Show more"
   * goes to the home feed instead.
   */
  overviewFiltersInPlace?: boolean
}

const ShowtimeFeedPage = ({
  feed,
  header,
  emptyText = "No upcoming screenings.",
  filteredEmptyText = "No screenings match these filters.",
  emptyState,
  hasNav = true,
  showRail = true,
  showPresets = true,
  showGroupToggle = false,
  overviewFiltersInPlace = false,
  isSwitchingLayout = false,
}: ShowtimeFeedPageProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isMobile = useIsMobile()
  const hasOverview = !isMobile
  const isSignedIn = useIsSignedIn()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const overview = useFeedOverview({
    feedParams: feed.params,
    enabled: hasOverview && isSignedIn,
    paused: selectedId !== null,
  })

  // The rows on screen trail the query by a render (see the note above). Until
  // they have caught up the sentinel still sits where the old list ended, in
  // plain view, so it would ask for page after page — and each one would
  // restart the render that is trying to catch up. Measured: 5,000 cards
  // loaded and the first page never drew. So a list still being drawn counts
  // as a page still loading.
  // Deferred together with the filters they belong to, so a lagging copy can
  // be recognised as the *previous* filter's rows rather than painted as if
  // it were the current ones — which is what made the old wall flash back up
  // between the loading screen and the new one, on a filter combination whose
  // rows were already cached and so arrived with no loading state at all.
  const shown = useMemo(
    () => ({ key: feed.filtersKey, rows: feed.showtimes }),
    [feed.filtersKey, feed.showtimes],
  )
  const deferred = useDeferredValue(shown)
  const isDrawingRows = deferred !== shown
  // The defer exists for *pagination*, where the rows on screen are still
  // correct and only being added to, so easing the paint is worth a frame of
  // lag. A filter change is the opposite: those rows are wrong outright.
  const isSwappingRows =
    feed.isReplacingRows || deferred.key !== feed.filtersKey
  // And on the way out to the film rows, the tickets go with the loading
  // screen rather than standing under it.
  const rows =
    isSwappingRows || isSwitchingLayout ? NO_SHOWTIMES : deferred.rows
  // The loading screen stands in whenever there is nothing to draw and the
  // feed is not actually empty: the swap above, the first load, and the frame
  // or two where the deferred copy is still behind a list that has arrived.
  // A search narrowing the list keeps the rows it has rather than blanking
  // under every letter, so it never reaches this.
  const isLoadingRows =
    isSwitchingLayout || isSwappingRows || (rows.length === 0 && !feed.isEmpty)

  useInfiniteScroll({
    fetchNextPage: feed.fetchNextPage,
    // Not mid-switch: the loading screen puts the sentinel in view, and the
    // feed being left would fetch page after page on its way out.
    hasNextPage: feed.hasNextPage && !isSwitchingLayout,
    isFetchingNextPage: feed.isFetchingNextPage || isDrawingRows,
    loadMoreRef,
    rootMargin: SCROLL_RUNWAY,
  })

  // A showtime that has dropped out of the filtered result set should not keep
  // a panel open beside a feed that no longer contains it. One picked from the
  // overview may be far past the loaded rows, so its rows count too — and the
  // overview holds still while one of them is open (`paused` above). One
  // opened from a notification may be in neither, so it is held apart
  // (`useHeldShowtime`), still patched by status writes like any feed's copy.
  const { held, hold } = useHeldShowtime()
  const selected =
    feed.showtimes.find((showtime) => showtime.id === selectedId) ??
    overview.showtimes.find((showtime) => showtime.id === selectedId) ??
    (held && held.id === selectedId ? held : null)
  useEffect(() => {
    if (selectedId !== null && !selected && !feed.isLoading) setSelectedId(null)
  }, [selectedId, selected, feed.isLoading])

  const handleSelect = useCallback((showtime: ShowtimePublic) => {
    setSelectedId((current) => (current === showtime.id ? null : showtime.id))
  }, [])
  const handleClose = useCallback(() => setSelectedId(null), [])

  const openFromElsewhere = useCallback(
    (showtime: ShowtimePublic) => {
      hold(showtime)
      setSelectedId(showtime.id)
    },
    [hold],
  )
  useShowtimePanelSlot(openFromElsewhere)

  // The panel follows the selection a render behind, and is memoised on that
  // copy so the urgent render — the one that paints the ring — skips it.
  const panelShowtime = useDeferredValue(selected)
  const panel = useMemo(
    () =>
      panelShowtime ? (
        <ShowtimeDetailPanel showtime={panelShowtime} onClose={handleClose} />
      ) : null,
    [panelShowtime, handleClose],
  )
  const hasActiveFilters =
    feed.activeFilterCount > 0 || feed.params.q.trim() !== ""
  const navigate = useNavigate()
  const applyOverviewFilters = useCallback(
    (params: FeedParams) => {
      if (overviewFiltersInPlace) {
        feed.applyParams(params)
        return
      }
      void navigate({
        to: "/",
        search: stripDefaultFeedParams(params) as never,
      })
    },
    [overviewFiltersInPlace, feed.applyParams, navigate],
  )
  const overviewPanel = useMemo(
    () =>
      hasOverview ? (
        <FeedOverviewPanel
          overview={isSignedIn ? overview : null}
          feedParams={feed.params}
          hasActiveFilters={hasActiveFilters}
          onSelect={handleSelect}
          onApplyFilters={applyOverviewFilters}
        />
      ) : null,
    [
      hasOverview,
      isSignedIn,
      overview,
      feed.params,
      hasActiveFilters,
      handleSelect,
      applyOverviewFilters,
    ],
  )

  // Rows fade and lift in as they arrive, like the app's (`use-feed-entrance`).
  const entranceDelays = useFeedEntranceDelays(
    rows.map((showtime) => showtime.id),
  )
  const cards = rows.map((showtime) => {
    const delay = entranceDelays.get(showtime.id) ?? 0
    return (
      <div
        key={showtime.id}
        className={FEED_ITEM_CLASS}
        style={
          delay ? { ...CELL_STYLE, animationDelay: `${delay}ms` } : CELL_STYLE
        }
      >
        <Card
          showtime={showtime}
          isSelected={showtime.id === selectedId}
          onSelect={handleSelect}
        />
      </div>
    )
  })

  // Render/output using the state and derived values prepared above.
  return (
    <FeedPageShell
      feed={feed}
      header={header}
      emptyText={emptyText}
      filteredEmptyText={filteredEmptyText}
      emptyState={emptyState}
      hasNav={hasNav}
      showRail={showRail}
      showPresets={showPresets}
      showGroupToggle={showGroupToggle}
      loadMoreRef={loadMoreRef}
      grid
      minListWidth={PORTRAIT_MIN_COLUMN_WIDTH}
      railFooter={renderWallColumnsControl}
      detail={isMobile ? null : (panel ?? overviewPanel)}
      isLoadingMore={feed.isFetchingNextPage || isDrawingRows}
      isLoadingRows={isLoadingRows}
    >
      <TicketWall>{cards}</TicketWall>

      {/* On a phone there is no room for a docked panel, so the selection opens
          under the list until it becomes a drawer. The panel paints its own
          card, so this only insets it from the screen edges. */}
      {isMobile && selected ? (
        <Box px={2} py={3}>
          <ShowtimeDetailPanel showtime={selected} onClose={handleClose} />
        </Box>
      ) : null}
    </FeedPageShell>
  )
}

export default ShowtimeFeedPage
