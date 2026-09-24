/**
 * A film's own page: the film at the top, its whole run below it, and the
 * shipped `ShowtimeDetailPanel` docked beside both when a screening is
 * pressed — the same panel the feeds dock, so acting on a screening never
 * hides the alternatives you were choosing between. The layout itself is
 * `MovieDetail`'s.
 *
 * The page sits outside `_layout` — it is where a shared link lands — so it
 * carries the site's nav itself, in flow under the notice banner.
 *
 * The feed's filter rail docks on the left, cut down to the filters that
 * narrow screenings: cinemas, language, days, time of day and whose plans.
 * The ones that choose films are pinned to their defaults — the film is
 * already chosen, so all they could do is empty its run. The filters live in
 * the URL, as the feed's do.
 */
import { Box, Center, Flex, Spinner, Text } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { MoviesReadMovieResponse, ShowtimePublic } from "shared"
import { MoviesService } from "shared"

import TopNavBar from "@/components/Common/TopNavBar"
import FeedFilterRail from "@/components/Feed/FeedFilterRail"
import {
  DETAIL_WIDTH,
  RAIL_WIDTH,
  RAISED_PANEL_ATTRIBUTE,
  RAISED_PANEL_Z_INDEX,
} from "@/components/Feed/FeedLayout"
import {
  RAIL_STRIP_GAP,
  RAIL_STRIP_WIDTH,
  RailStrip,
} from "@/components/Feed/RailCollapse"
import {
  DETAIL_FADE_MS,
  detailCardStyle,
  detailColumnStyle,
  useDetailColumn,
} from "@/components/Feed/useDetailColumn"
import MovieDetail from "@/components/Movie/MovieDetail"
import type { FilmTime } from "@/components/Movies/cards/film-card-kit"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import { PAGE_NOTICE_BANNER_OFFSET_CSS } from "@/constants"
import {
  FILM_LEVEL_FEED_PARAMS,
  feedParamsToApiFilters,
} from "@/features/showtimes/feed-params"
import { usePreferredCinemaIds } from "@/features/showtimes/guest-preferred-cinemas"
import { useShowtimePanelSlot } from "@/features/showtimes/showtime-panel-slot"
import { useFeedParams } from "@/features/showtimes/useFeedParams"
import { useHeldShowtime } from "@/features/showtimes/useHeldShowtime"
import { useIsMobile } from "@/hooks/useIsMobile"
import { Route } from "@/routes/movie.$movieId"

/**
 * How wide the film itself may get. A poster and a paragraph do not improve
 * past this — the rest of an ultrawide monitor is margin, or the panel.
 */
const FILM_MAX_WIDTH = 1100
/**
 * The narrowest the film may be beside the full filters and the panel. Past
 * this the header's poster, synopsis and friends stop fitting side by side, so
 * the filters give up their room for good instead (see `isRailFolded`).
 */
const FILM_MIN_WIDTH = 640
/** Tight on purpose: every pixel here is one the film does not get. */
const COLUMN_GAP = 16
/** The widest the detail column is ever asked to be (`DETAIL_WIDTH`'s `2xl`). */
const DETAIL_MAX_WIDTH = 520
/**
 * The pair, capped so that the cap never eats into the film: exactly enough for
 * a full-width film beside a full-width panel. Set to anything less and opening
 * the panel on a large monitor would take the difference out of the film.
 *
 * The pair is centred, so opening a screening slides the whole film left into
 * the room it always leaves for the panel — see `FILM_WIDTH_BESIDE_PANEL`.
 * Tried the other way (film anchored, panel opening beside it, film narrowing
 * to fit) on 2026-09-22: a shrinking poster and a re-wrapping run felt worse
 * than the slide.
 */
const CONTENT_MAX_WIDTH = FILM_MAX_WIDTH + COLUMN_GAP + DETAIL_MAX_WIDTH
const PANEL_INSET = 16

/**
 * The film's width, panel open or not: whatever is left beside a fully open
 * panel. So opening a screening never resizes the film — the room is already
 * there, and the film only slides over to make it.
 */
const FILM_WIDTH_BESIDE_PANEL = Object.fromEntries(
  Object.entries(DETAIL_WIDTH).map(([key, value]) => [
    key,
    `min(${FILM_MAX_WIDTH}px, calc(100% - ${COLUMN_GAP}px - ${value}))`,
  ]),
)

/**
 * Where the panel pins, and how tall it may get. The nav is in the document
 * flow and scrolls away with the page, so the only thing still fixed above the
 * panel once you have scrolled is the notice banner, when it is up.
 */
const PANEL_STICKY_TOP = `calc(${PAGE_NOTICE_BANNER_OFFSET_CSS} + ${PANEL_INSET}px)`
const PANEL_MAX_HEIGHT = `calc(100dvh - ${PAGE_NOTICE_BANNER_OFFSET_CSS} - ${
  2 * PANEL_INSET
}px)`

const MoviePage = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isMobile = useIsMobile()
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<number | null>(
    null,
  )
  const params = Route.useParams()
  const { movieId } = params as { movieId: string }
  const movieIdNumber = Number(movieId)
  const { showtime: linkedShowtimeId } = Route.useSearch()
  const [hasOpenedLinkedShowtime, setHasOpenedLinkedShowtime] = useState(false)
  // Data hooks keep this module synced with backend data and shared cache state.
  // A guest's preferred cinemas come from this browser, never the account
  // endpoint: asking that only earns a 401, retried, and the film waited out
  // every retry before it showed.
  const { data: selectedCinemaIds, isLoading: isLoadingSelectedCinemas } =
    usePreferredCinemaIds()
  const shouldWaitForCinemaSelection =
    isLoadingSelectedCinemas && selectedCinemaIds === undefined

  const feed = useFeedParams({ pinned: FILM_LEVEL_FEED_PARAMS })
  const filters = useMemo(
    () => feedParamsToApiFilters(feed.queryParams),
    [feed.queryParams],
  )

  // The filters are in the query key so cached data lines up with them. No
  // cinemas picked falls back to the account's saved ones, as it always did.
  const { data, isLoading } = useQuery<MoviesReadMovieResponse, Error>({
    queryKey: ["movie", movieIdNumber, selectedCinemaIds, filters],
    enabled:
      Number.isFinite(movieIdNumber) &&
      // `!== 0` (not `> 0`): synthetic listings like sneak previews use
      // negative movie ids. 0 and NaN remain invalid.
      movieIdNumber !== 0 &&
      !shouldWaitForCinemaSelection,
    queryFn: () =>
      MoviesService.readMovie({
        ...filters,
        id: movieIdNumber,
        selectedCinemaIds: filters.selectedCinemaIds ?? selectedCinemaIds,
      }),
    // A filter change swaps the run, not the page: the film stays up while its
    // screenings are fetched again. Only for this film, though — arriving at
    // another one must not show the last one's poster in the meantime.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === movieIdNumber ? previous : undefined,
  })

  const isMovieLoading = shouldWaitForCinemaSelection || (isLoading && !data)

  /**
   * The screening the panel is open on, built where it is used rather than
   * kept in state: only its *id* is remembered, so a status change that
   * refetches the film leaves the panel looking at the new row instead of the
   * copy it was handed when the plate was pressed. The panel wants a whole
   * `ShowtimePublic`, and a screening listed under a film is exactly one minus
   * the film — it was listed *under* it, so it carries no copy of it.
   *
   * Nor does it carry the friends who watchlisted or watched the film: those
   * are the film's, not the screening's, so the page sends them once on the
   * film's own `viewer` rather than on every screening. The panel reads them
   * off the screening (its watch pills, and the Invite beside each name), so
   * they are put back here — the same lists the feed's screenings carry.
   *
   * A screening opened from a notification can be another film's, so it falls
   * back to the held copy (`useHeldShowtime`), which status writes patch too.
   * That one already carries its own film's lists.
   */
  const { held, hold } = useHeldShowtime()
  const selectedShowtime: ShowtimePublic | null = useMemo(() => {
    if (selectedShowtimeId === null) return null
    const found = data?.showtimes.find(
      (showtime) => showtime.id === selectedShowtimeId,
    )
    if (found && data) {
      return {
        ...found,
        movie: data,
        viewer: found.viewer
          ? {
              ...found.viewer,
              friends_watchlisted: data.viewer?.friends_watchlisted,
              friends_watched: data.viewer?.friends_watched,
            }
          : found.viewer,
      }
    }
    return held && held.id === selectedShowtimeId ? held : null
  }, [data, held, selectedShowtimeId])

  // A screening filtered out from under the panel should not keep it open.
  useEffect(() => {
    if (selectedShowtimeId !== null && !selectedShowtime && !isMovieLoading) {
      setSelectedShowtimeId(null)
    }
  }, [selectedShowtimeId, selectedShowtime, isMovieLoading])

  // Open the showtime a notification email linked to, once, when it loads.
  useEffect(() => {
    if (hasOpenedLinkedShowtime || !linkedShowtimeId || !data) return
    if (!data.showtimes.some((showtime) => showtime.id === linkedShowtimeId))
      return
    setSelectedShowtimeId(linkedShowtimeId)
    setHasOpenedLinkedShowtime(true)
  }, [hasOpenedLinkedShowtime, linkedShowtimeId, data])

  /**
   * The docked panel opens and closes the way the feeds' does — the column
   * widens, then the card fades in; the card fades, then the column narrows —
   * rather than appearing in one frame and shoving the whole run sideways.
   * The screening is kept after it is deselected so there is still something
   * in the column while it closes.
   */
  const hasDockedPanel = !isMobile && selectedShowtime !== null
  const lastShowtime = useRef<ShowtimePublic | null>(null)
  if (selectedShowtime) lastShowtime.current = selectedShowtime
  const dockedShowtime = selectedShowtime ?? lastShowtime.current
  const detailColumn = useDetailColumn(hasDockedPanel)

  const handleSelectTime = useCallback((time: FilmTime) => {
    setSelectedShowtimeId((current) => (current === time.id ? null : time.id))
  }, [])
  const handleClose = useCallback(() => setSelectedShowtimeId(null), [])

  const openFromElsewhere = useCallback(
    (showtime: ShowtimePublic) => {
      hold(showtime)
      setSelectedShowtimeId(showtime.id)
    },
    [hold],
  )
  useShowtimePanelSlot(openFromElsewhere)

  // A plate is what opens the panel, so anything that isn't one closes it —
  // except the panel itself, whose own buttons (going, invite, seat map) have
  // to keep working without dismissing the thing they act on. Same rule as the
  // films feed's. A plate's own click handler stops its propagation, so this
  // never fights the toggle that lets pressing it again close the panel.
  useEffect(() => {
    if (!selectedShowtime) return
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
  }, [selectedShowtime, handleClose])

  // The feed drops its rail on a phone too; there is no room beside the film.
  const showRail = !isMobile

  /**
   * The filters are a strip whenever the full filters would leave the film
   * narrower than `FILM_MIN_WIDTH` beside the panel — whether or not a panel
   * is open, so opening one never changes anything but where the film sits.
   *
   * Worked out from the page's own width and two hidden rulers at the rail's
   * and the panel's full widths, never from the film, which is exactly what
   * moves when the rail folds.
   */
  const pageRef = useRef<HTMLDivElement>(null)
  const railRulerRef = useRef<HTMLDivElement>(null)
  const panelRulerRef = useRef<HTMLDivElement>(null)
  const [isShortOfRoom, setIsShortOfRoom] = useState(false)
  useLayoutEffect(() => {
    const page = pageRef.current
    const railRuler = railRulerRef.current
    const panelRuler = panelRulerRef.current
    if (!showRail || !page || !railRuler || !panelRuler) return
    const update = () => {
      const style = getComputedStyle(page)
      const pageWidth =
        page.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight)
      const filmRoom =
        pageWidth -
        railRuler.offsetWidth -
        COLUMN_GAP -
        panelRuler.offsetWidth -
        COLUMN_GAP
      setIsShortOfRoom(filmRoom < FILM_MIN_WIDTH)
    }
    update()
    // The rulers too: their widths step with the breakpoint.
    const observer = new ResizeObserver(update)
    observer.observe(page)
    observer.observe(railRuler)
    observer.observe(panelRuler)
    return () => observer.disconnect()
  }, [showRail])
  const isRailFolded = showRail && isShortOfRoom

  // Folded, the strip opens the filters over the film rather than docking
  // them back, which would only squeeze it again.
  const stripRef = useRef<HTMLDivElement>(null)
  const floatingRailRef = useRef<HTMLDivElement>(null)
  const [isRailFloating, setIsRailFloating] = useState(false)
  useEffect(() => {
    if (!isRailFolded) setIsRailFloating(false)
  }, [isRailFolded])
  // A click elsewhere on the page puts them away. Only clicks on the page
  // count: the cinema sheet is portalled to the body, and picking a cinema in
  // it must not close the filters it belongs to.
  useEffect(() => {
    if (!isRailFloating) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!pageRef.current?.contains(target)) return
      if (floatingRailRef.current?.contains(target)) return
      if (stripRef.current?.contains(target)) return
      setIsRailFloating(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [isRailFloating])

  const rail = (
    <FeedFilterRail
      params={feed.params}
      onChange={feed.setParams}
      onReset={feed.resetParams}
      activeFilterCount={feed.activeFilterCount}
      screeningsOnly
    />
  )
  /** Sticky beside the film, like the panel on the other side of it. */
  const railColumnStyle = {
    // Clicks in here keep the screening open (see the outside-press rule
    // above), as they do in the feed's rail.
    "data-feed-side-panel": "",
    flexShrink: 0,
    position: "sticky",
    top: PANEL_STICKY_TOP,
    maxH: PANEL_MAX_HEIGHT,
    overscrollBehavior: "contain",
    // The rail lifts itself above the cinema sheet's scrim; the sticky column
    // is its own stacking context, so it has to come up too.
    css: {
      [`&:has([${RAISED_PANEL_ATTRIBUTE}])`]: { zIndex: RAISED_PANEL_Z_INDEX },
    },
  } as const

  // Render/output using the state and derived values prepared above.
  return (
    <>
      {/* Outside `_layout`, so this page carries the site's nav itself, in
          flow under the notice banner. */}
      <Box mt={PAGE_NOTICE_BANNER_OFFSET_CSS}>
        <TopNavBar />
      </Box>
      {/* A plain box rather than `Common/Page`: that one exists to clear the
          fixed secondary bar this page no longer has, and its
          `overflow-x: hidden` makes it a scrollport the docked panel below
          could never stick in. */}
      <Flex
        ref={pageRef}
        position="relative"
        px={{ base: 3, md: 4 }}
        pt={{ base: 4, md: 5 }}
        pb={10}
        align="flex-start"
      >
        {showRail ? (
          <>
            <Box
              ref={railRulerRef}
              w={RAIL_WIDTH}
              h={0}
              position="absolute"
              visibility="hidden"
              pointerEvents="none"
              aria-hidden
            />
            <Box
              ref={panelRulerRef}
              w={DETAIL_WIDTH}
              h={0}
              position="absolute"
              visibility="hidden"
              pointerEvents="none"
              aria-hidden
            />
          </>
        ) : null}

        {/* Docked at the page's left edge rather than centred with the film,
            so opening a screening slides the film and not the filters.

            One column for both the full filters and the strip: the filters
            stay mounted either way, and the strip opens those same ones over
            the film rather than building a second set. */}
        {showRail ? (
          <Box
            as="aside"
            {...railColumnStyle}
            w={isRailFolded ? RAIL_STRIP_WIDTH : RAIL_WIDTH}
            me={`${isRailFolded ? RAIL_STRIP_GAP : COLUMN_GAP}px`}
            // Docked, the column scrolls the filters; folded, it clips them
            // as it narrows; floating, they hang out past the strip, over the
            // film. Not `hidden` on one axis and `visible` on the other: that
            // pair computes to a scroll box, which clipped the strip away.
            overflowX={isRailFloating ? "visible" : "hidden"}
            overflowY={
              isRailFloating ? "visible" : isRailFolded ? "hidden" : "auto"
            }
            zIndex={isRailFloating ? 4 : undefined}
          >
            <Box
              position={isRailFolded ? "static" : "absolute"}
              top={0}
              left={0}
              visibility={isRailFolded ? "visible" : "hidden"}
              aria-hidden={!isRailFolded}
            >
              <RailStrip
                stripRef={stripRef}
                activeFilterCount={feed.activeFilterCount}
                isOpen={isRailFloating}
                onToggle={() => setIsRailFloating((current) => !current)}
              />
            </Box>
            <Box
              ref={floatingRailRef}
              w={RAIL_WIDTH}
              position={isRailFolded ? "absolute" : "static"}
              top={0}
              left={
                isRailFolded ? `calc(100% + ${RAIL_STRIP_GAP}px)` : undefined
              }
              maxH={isRailFolded ? PANEL_MAX_HEIGHT : undefined}
              overflowY={isRailFolded ? "auto" : undefined}
              overscrollBehavior="contain"
              borderRadius="md"
              boxShadow={isRailFloating ? "lg" : undefined}
              opacity={isRailFolded && !isRailFloating ? 0 : 1}
              transform={
                isRailFolded && !isRailFloating ? "translateX(-8px)" : "none"
              }
              visibility={
                isRailFolded && !isRailFloating ? "hidden" : "visible"
              }
              // Floating in and out only; folding itself happens on a resize,
              // not under anyone's pointer, so it does not animate.
              transition={
                isRailFolded
                  ? isRailFloating
                    ? `opacity ${DETAIL_FADE_MS}ms ease, transform ${DETAIL_FADE_MS}ms ease`
                    : `opacity ${DETAIL_FADE_MS}ms ease, transform ${DETAIL_FADE_MS}ms ease, visibility 0s ${DETAIL_FADE_MS}ms`
                  : undefined
              }
            >
              {rail}
            </Box>
          </Box>
        ) : null}

        <Box flex="1 1 auto" minW={0}>
          {isMovieLoading ? (
            <Center h="50vh">
              <Spinner size="xl" />
            </Center>
          ) : !data ? (
            // A film that was pulled, an id that is not one, or a request that
            // failed. The page said nothing at all in this case before — it drew
            // its own chrome around an empty poster and a blank title.
            <Center h="50vh">
              <Text color="fg.muted">This film could not be loaded.</Text>
            </Center>
          ) : (
            <Flex
              maxW={`${CONTENT_MAX_WIDTH}px`}
              mx="auto"
              align="flex-start"
              justify="center"
            >
              <Box
                flex="0 0 auto"
                // A phone has no docked panel to leave room for.
                w={isMobile ? "100%" : FILM_WIDTH_BESIDE_PANEL}
                minW={0}
              >
                <MovieDetail
                  movie={data}
                  selectedShowtimeId={selectedShowtimeId}
                  onSelectTime={handleSelectTime}
                  emptyText={
                    feed.activeFilterCount > 0
                      ? "No screenings match these filters"
                      : undefined
                  }
                />

                {/* On a phone there is no room for a docked panel, so the
                    selection opens under the film until it becomes a drawer. The
                    panel paints its own card, so this only insets it. */}
                {isMobile && selectedShowtime ? (
                  <Box py={3}>
                    <ShowtimeDetailPanel
                      showtime={selectedShowtime}
                      onClose={handleClose}
                    />
                  </Box>
                ) : null}
              </Box>

              {/* Sticky rather than full-height, like the feed's own column: the
                  card ends where its content does and the page reads through
                  underneath it. */}
              {!isMobile && detailColumn.isMounted && dockedShowtime ? (
                <Box
                  as="aside"
                  ref={detailColumn.columnRef}
                  // `SIDE_PANEL_SCROLLER_ATTRIBUTE`: what the panel looks for
                  // when it scrolls itself back to the top on a new screening.
                  data-feed-side-panel=""
                  // The gap is the column's own margin rather than the row's
                  // `gap`, so it closes with the width instead of snapping.
                  {...detailColumnStyle(DETAIL_WIDTH, COLUMN_GAP, detailColumn)}
                  flexShrink={0}
                  position="sticky"
                  top={PANEL_STICKY_TOP}
                  maxH={PANEL_MAX_HEIGHT}
                  overflowY="auto"
                  // A panel that does scroll internally keeps its wheel to
                  // itself rather than handing the overflow to the page.
                  overscrollBehavior="contain"
                >
                  <Box {...detailCardStyle(DETAIL_WIDTH, detailColumn.isOpen)}>
                    <ShowtimeDetailPanel
                      showtime={dockedShowtime}
                      onClose={handleClose}
                    />
                  </Box>
                </Box>
              ) : null}
            </Flex>
          )}
        </Box>
      </Flex>
    </>
  )
}

export default MoviePage
