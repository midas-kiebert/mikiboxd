/**
 * The shell every feed screen sits in: a toolbar across the top, then filters
 * on the left, the list in the middle, a detail panel on the right.
 *
 * On a desktop the whole content area is one scroll container and everything
 * that stays put — the toolbar, both side panels — is `position: sticky` inside
 * it. The alternative, giving each column its own `overflow: auto`, is what
 * this replaced: it put a second scrollbar next to the showtimes and made the
 * filters feel like a separate window rather than part of the page. Cineville's
 * filmagenda is the reference for the behaviour.
 *
 * A sticky panel is only as tall as its content, so the margin around it is
 * real space and the page underneath reads through. `panelMaxHeight` is the
 * safety valve for a panel that outgrows the viewport.
 *
 * The toolbar spans the full width above the columns rather than sitting over
 * the list alone, which is what makes the measuring below necessary: the panels
 * pin *underneath* it, and it is not a fixed height — it grows a presets row
 * when you are signed in and a header on a cinema's page. Its height goes out
 * as a CSS custom property so the panels can offset by it without this
 * component re-rendering every time it changes.
 *
 * All of the geometry lives here, in the constants at the top and the one grid
 * below. Screens hand it slots and never position anything themselves, so
 * changing the layout — different widths, a different column order, the rail
 * moved to the right, the detail panel turned into an overlay — is an edit to
 * this file alone and no screen has to know it happened.
 *
 * The shape is the app's, spent differently: the app stacks a toolbar over a
 * list because a phone has one column, and hides filters behind a button and
 * the showtime panel behind a full-screen sheet for the same reason. Here the
 * filters stay open and the panel sits beside the list, so acting on one
 * showtime does not hide the others.
 */
import { Box, Flex } from "@chakra-ui/react"
import {
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { PAGE_NOTICE_BANNER_OFFSET_CSS, TOP_NAV_HEIGHT } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"

/** The fixed bottom nav on narrow screens, which content has to clear. */
const BOTTOM_NAV_HEIGHT = 60

/**
 * Filter rail. Wide enough for a row of day pills without wrapping every three,
 * and for cinema chips to wrap two or three to a line — the width the old
 * sidebar was spending on four words and an icon.
 *
 * Narrower below `2xl`, because a 1280px laptop showing the rail and the detail
 * panel at full width leaves the list between them narrow enough to truncate
 * most film titles — the ribbon `LIST_MAX_WIDTH` prevents at the other end.
 */
export const RAIL_WIDTH = { base: "360px", "2xl": "400px" }
/**
 * Detail panel. Wide enough for a proper poster beside the screening's
 * particulars, for a row of three status buttons that do not truncate their
 * labels, and for the seat floor plan to draw a room rather than a squeezed
 * one — it carries the whole of what the app's sheet does, so it is sized like
 * a panel and not like a tooltip.
 *
 * Stepped by breakpoint rather than fixed, and for the same reason the rail
 * steps: the panel and the rail are both taken out of the list between them,
 * so the width that makes this comfortable on a large monitor is the width
 * that turns the feed into a ribbon on a 13" laptop. Grown a second time on
 * request, once `LIST_MAX_WIDTH` below gave the list room to give up: a
 * showtime row does not need the width of a film's whole synopsis, and the
 * panel is the thing with a poster, a floor plan and five sections in it.
 */
export const DETAIL_WIDTH = {
  base: "340px",
  lg: "380px",
  xl: "420px",
  "2xl": "520px",
}
/**
 * Keeps the list from becoming an unreadable ribbon on an ultrawide monitor —
 * and, since a showtime row is just a poster, a date and a title, keeps it from
 * becoming a mostly-empty one on an ordinary monitor either. Narrowed from
 * 900px alongside the wider `DETAIL_WIDTH` above: the row was carrying dead
 * space the detail panel could put to better use.
 *
 * The growth in `DETAIL_WIDTH` is back-loaded onto `2xl` rather than spread
 * evenly, which is the fix for a real regression: an even step widened every
 * breakpoint, and at a plain 1280px laptop window that left the list column
 * so little of what's left over that a title truncated to its first letter.
 * The room this panel wanted was there on a wide monitor already — that is
 * where `2xl` alone now takes it from.
 */
export const LIST_MAX_WIDTH = 760

/**
 * The page's left and right margin. Generous, because there is room for it now
 * that the navigation is a bar across the top rather than a column taking 264px
 * off the left of every screen.
 */
const PAGE_INSET_X = 40

/** The gap between the toolbar and the top of the list. */
const ROW_INSET_TOP = 16

/**
 * How far below the toolbar the two floating cards start — well below the list,
 * so they read as panels set into the page rather than as more chrome hung off
 * the bar.
 *
 * It is also the offset they pin at, measured from the toolbar's own bottom
 * edge, so the inset a card has while the page is at rest is the one it keeps
 * while pinned. Those being one number is what stops a card jumping on the
 * first scroll.
 */
const PANEL_INSET_TOP = 56

/** How close a pinned card may come to the bottom of the viewport. */
const PANEL_INSET_BOTTOM = 16

/** Between the columns. */
const COLUMN_GAP = 24

/**
 * How long the detail column takes to open or close, and how long the card
 * inside it takes to fade.
 *
 * Two clocks rather than one, because the column and the card are doing
 * different jobs. The column's width is a *layout* change — the list beside it
 * genuinely gets narrower — and that wants to be unhurried enough to read as
 * the page making room. The card is just arriving, and it must be gone before
 * the column has finished closing around it: a card that fades on the same
 * clock as the width appears to be crushed rather than dismissed. So closing
 * fades first and narrows after, and opening widens first and fades in last.
 */
const DETAIL_WIDTH_MS = 220
const DETAIL_FADE_MS = 140

/**
 * Marks the element a floating column actually scrolls in.
 *
 * A panel that wants to scroll itself back to the top — the showtime panel
 * does, on every change of selection — has to find that element, and it is
 * this component's business which one it is, not the panel's. Published as an
 * attribute rather than a ref so a panel several levels deep can reach it with
 * `closest()` and no prop has to be threaded through.
 */
export const SIDE_PANEL_SCROLLER_ATTRIBUTE = "data-feed-side-panel"

/**
 * The toolbar's measured height, published on the scroll container.
 *
 * A custom property rather than state: the panels are siblings of the toolbar,
 * not children, and the value changes on a resize and on every route that gives
 * the toolbar another row. Writing it to the DOM keeps those changes out of
 * React's render path entirely — the same trick the notice banner uses for its
 * own height.
 */
const TOOLBAR_HEIGHT_VAR = "--feed-toolbar-height"
const TOOLBAR_HEIGHT_CSS = `var(${TOOLBAR_HEIGHT_VAR}, 0px)`

// The shell measures the viewport itself rather than inheriting a percentage
// height. Inside `_layout` the parent is a scroll box of exactly this height,
// so the two agree; the deep-link routes outside it have no sized parent at
// all, and a percentage there resolves to auto and quietly gives the page its
// scroll back. Above it sit the notice banner, when it is up, and — on a page
// that has the site's navigation — the nav bar, which is in the document flow
// and so has already taken its height out of the parent.
const shellHeight = (hasNav: boolean) =>
  `calc(100dvh - ${PAGE_NOTICE_BANNER_OFFSET_CSS}${hasNav ? ` - ${TOP_NAV_HEIGHT}px` : ""})`

/**
 * A pinned panel taller than this would have its bottom stuck off-screen and
 * unreachable, since the page scroll no longer moves it. Measured from the
 * viewport rather than from the parent: the flex row around it is only as tall
 * as its content, so a percentage here would resolve against the wrong thing.
 */
const panelMaxHeight = (hasNav: boolean) =>
  `calc(${shellHeight(hasNav)} - ${TOOLBAR_HEIGHT_CSS} - ${
    PANEL_INSET_TOP + PANEL_INSET_BOTTOM
  }px)`

/** Where a panel pins: under the sticky toolbar, plus its own inset. */
const PANEL_STICKY_TOP = `calc(${TOOLBAR_HEIGHT_CSS} + ${PANEL_INSET_TOP}px)`

type FeedLayoutProps = {
  /** Filter controls. Hidden on narrow screens until it becomes a drawer. */
  rail?: ReactNode
  /** Search and the controls that belong above the list. Stays put while the list scrolls. */
  toolbar?: ReactNode
  /** The feed itself. */
  children: ReactNode
  /** The selected showtime, when there is one. */
  detail?: ReactNode
  /**
   * False on the routes that sit outside `_layout` and so carry none of the
   * site's chrome — the deep-link targets the app sends people to. They have
   * no nav bar above them and no bottom bar below.
   */
  hasNav?: boolean
}

/**
 * A column held at an exact size with its transition switched off, which is how
 * both the cold open and the mid-close reopen get a start value to animate from.
 * `gap` travels with `width` because the leading margin is on the same clock:
 * pinning one without the other moves the column by the gap in a single frame.
 */
type PinnedColumn = { width: number; gap: number }

/** A column that is not on screen: both the start of an open and the end of a close. */
const CLOSED_COLUMN: PinnedColumn = { width: 0, gap: 0 }

const measureColumn = (element: HTMLElement | null): PinnedColumn =>
  element
    ? {
        width: element.getBoundingClientRect().width,
        gap:
          Number.parseFloat(getComputedStyle(element).marginInlineStart) || 0,
      }
    : CLOSED_COLUMN

/**
 * `arming` is the commit that renders the panel, with the column pinned so that
 * render cannot eat into the animation; see the state machine in `FeedLayout`.
 */
type DetailPhase = "closed" | "arming" | "open" | "closing"

/**
 * One of the two floating columns. Sticky rather than full-height, so the card
 * ends where its content does and the page shows through underneath it.
 *
 * `bare` is for a panel whose content paints its own card. The filter rail
 * does: it has a colour and a corner radius of its own, and its section
 * dividers run the full width, which they cannot do through someone else's
 * padding. Everything else takes the plain panel card offered here.
 *
 * `collapsed` closes the column to nothing without unmounting it, which is how
 * the detail panel opens and shuts. The gap in front of it is this component's
 * `leadingGap` rather than the row's `gap` for exactly that reason: a
 * zero-width flex item still gets a gap, so a closed panel left a 24px hole
 * that snapped away at the end of the animation. Owning the gap lets it close
 * with the width. The rail takes the other half of that arrangement as
 * `trailingGap`.
 *
 * Both are margins on the aside itself and not on a wrapper around it. A
 * wrapper would become the sticky element's containing block, and since these
 * columns are `align-self: flex-start` it would be exactly as tall as the
 * panel — leaving `position: sticky` nowhere to travel and silently ending the
 * pinning that is the whole point of them.
 */
const SidePanel = ({
  width,
  maxH,
  bare = false,
  collapsed = false,
  pinned = null,
  panelRef,
  leadingGap = 0,
  trailingGap = 0,
  children,
}: {
  width: Record<string, string>
  maxH: string
  bare?: boolean
  collapsed?: boolean
  pinned?: PinnedColumn | null
  panelRef?: Ref<HTMLDivElement>
  leadingGap?: number
  trailingGap?: number
  children: ReactNode
}) => (
  <Box
    as="aside"
    ref={panelRef}
    data-feed-side-panel=""
    w={pinned ? `${pinned.width}px` : collapsed ? "0px" : width}
    ms={pinned ? `${pinned.gap}px` : collapsed ? "0px" : `${leadingGap}px`}
    me={`${trailingGap}px`}
    transition={
      pinned
        ? "none"
        : `width ${DETAIL_WIDTH_MS}ms ease, margin-inline-start ${DETAIL_WIDTH_MS}ms ease`
    }
    // The card keeps its own width while the column shuts around it, so it
    // leaves rather than being squeezed.
    overflowX="hidden"
    flexShrink={0}
    position="sticky"
    top={PANEL_STICKY_TOP}
    // Takes the card from the row's own top inset down to where it pins, so it
    // starts exactly where it will stay.
    mt={`${PANEL_INSET_TOP - ROW_INSET_TOP}px`}
    alignSelf="flex-start"
    maxH={maxH}
    overflowY="auto"
    // A panel that does scroll internally keeps its wheel to itself rather than
    // handing the overflow to the feed behind it.
    overscrollBehavior="contain"
    bg={bare ? undefined : "bg.panel"}
    borderWidth={bare ? undefined : "1px"}
    borderColor={bare ? undefined : "border"}
    borderRadius={bare ? undefined : "md"}
    boxShadow={bare ? undefined : "sm"}
    p={bare ? 0 : 3}
  >
    <Box
      // Full width of the *content* box while open, so a panel long enough to
      // scroll does not have its own scrollbar cut a strip off its right edge.
      // Pinned to the column's width only while it shuts, which is the case the
      // fixed width is actually for: the card has to leave at full size rather
      // than be squeezed into nothing on the way out.
      w={collapsed ? width : "100%"}
      opacity={collapsed ? 0 : 1}
      // Opening: the column widens, and the card arrives into the space that
      // is already there. Closing: the card goes first, so the width finishes
      // on an empty column.
      transition={
        collapsed
          ? `opacity ${DETAIL_FADE_MS}ms ease`
          : `opacity ${DETAIL_FADE_MS}ms ease ${DETAIL_WIDTH_MS - DETAIL_FADE_MS}ms`
      }
    >
      {children}
    </Box>
  </Box>
)

const FeedLayout = ({
  rail,
  toolbar,
  children,
  detail,
  hasNav = true,
}: FeedLayoutProps) => {
  const isMobile = useIsMobile()
  const showRail = Boolean(rail) && !isMobile
  const maxPanelHeight = panelMaxHeight(hasNav)

  /**
   * The detail column opens and closes rather than appearing and vanishing.
   *
   * The thing that makes this harder than a CSS class toggle is that rendering
   * the panel is *expensive* — measured at 43-110ms of blocked main thread, it
   * being a poster, five sections and a handful of queries. A CSS transition
   * keeps its own clock while the main thread is blocked, so flipping the width
   * in the same commit that renders the panel loses however long that render
   * takes: nothing paints, the clock runs on, and the first frame the eye
   * actually gets is already a third of the way through. Measured reopening
   * mid-close, the column sat still at 112px for 62ms and then appeared at
   * 213px — a jump of 101px in one frame, which is the lurch that reads as the
   * panel snapping open. The band it happened in is exactly the one that gets
   * reported: too late for the close to still be near full width, too early for
   * it to have finished and unmounted.
   *
   * So the column is never asked to animate out of a commit that renders the
   * panel. `arming` is that commit: the panel renders, and the column is held
   * at an exact size with its transition off, so the expensive frame cannot
   * consume any of the animation. Two frames later — one is not enough, an
   * effect runs after a commit but before it has necessarily painted — the pin
   * comes off and the column travels.
   *
   * `paintedColumn` is what a mid-close reopen pins to. It has to be the last
   * size the column was *painted* at rather than what it measures at the moment
   * of the click, because those differ by exactly the blocked render: the
   * transition would have carried on shrinking behind it. Sampling every frame
   * while closing gives the painted value for free — a blocked main thread runs
   * no frames, so the last sample is the last thing drawn.
   *
   * `lastDetail` is what the close animates out: by then the caller has already
   * stopped passing a panel. A ref rather than state because writing it is
   * idempotent and must not cause a render of its own — the node identity
   * changes every render, so a state write here would never settle.
   */
  const hasDetail = Boolean(detail) && !isMobile
  const lastDetail = useRef<ReactNode>(null)
  if (detail) lastDetail.current = detail

  const [detailPhase, setDetailPhase] = useState<DetailPhase>(
    hasDetail ? "open" : "closed",
  )
  const [pinnedColumn, setPinnedColumn] = useState<PinnedColumn | null>(null)
  const detailColumnRef = useRef<HTMLDivElement>(null)
  const paintedColumn = useRef<PinnedColumn>(CLOSED_COLUMN)
  // The phase as the *previous* commit left it, for the effect below, which
  // reacts to `hasDetail` alone: taking the phase as a dependency would re-run
  // it — and cancel the frames an arming column is waiting on — every time it
  // moved the phase on itself.
  const detailPhaseRef = useRef(detailPhase)
  detailPhaseRef.current = detailPhase

  const isDetailMounted = detailPhase !== "closed"
  const isDetailOpen = detailPhase === "open"

  // The unmount is scheduled here, alongside the click that causes it, rather
  // than from an effect keyed on the phase. A phase-keyed effect only clears
  // the timer in the *commit* that leaves `closing`, and a reopen arriving in
  // the last twenty milliseconds of the close does not get that far in time:
  // the render is slow enough that the timer comes due while it runs, so it
  // fires in the gap between this effect and that commit and takes the panel
  // to `closed` after it had already been armed to reopen. Reopening at a
  // 200-220ms gap left the panel shut for good. Clearing it in this effect's
  // own cleanup is synchronous with the click and cannot lose that race.
  useEffect(() => {
    if (hasDetail) {
      // From `closed` there is nothing on screen to pin to and the column
      // starts from nothing; from `closing` it picks up where it was drawn.
      setPinnedColumn(
        detailPhaseRef.current === "closed"
          ? CLOSED_COLUMN
          : paintedColumn.current,
      )
      setDetailPhase("arming")
      return
    }
    if (detailPhaseRef.current === "closed") return
    // Read before the phase changes: this still measures the open column.
    paintedColumn.current = measureColumn(detailColumnRef.current)
    setPinnedColumn(null)
    setDetailPhase("closing")
    // Unmounted once it is shut, so a closed panel's queries — the seat
    // availability poll, most of all — do not keep running behind the page.
    const timer = setTimeout(() => setDetailPhase("closed"), DETAIL_WIDTH_MS)
    return () => clearTimeout(timer)
  }, [hasDetail])

  useEffect(() => {
    if (detailPhase !== "arming") return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setPinnedColumn(null)
        setDetailPhase("open")
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [detailPhase])

  useEffect(() => {
    if (detailPhase !== "closing") return
    let frame = requestAnimationFrame(function sample() {
      paintedColumn.current = measureColumn(detailColumnRef.current)
      frame = requestAnimationFrame(sample)
    })
    return () => cancelAnimationFrame(frame)
  }, [detailPhase])

  const scrollRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // Publish the toolbar's height for the panels to pin below. A layout effect
  // rather than an ordinary one, so the first paint already has the real number
  // and no card is drawn under the bar and then moved.
  useLayoutEffect(() => {
    const bar = toolbarRef.current
    const scroller = scrollRef.current
    if (!bar || !scroller) return

    const publish = () =>
      scroller.style.setProperty(TOOLBAR_HEIGHT_VAR, `${bar.offsetHeight}px`)

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  // On a desktop the content area fills the viewport and scrolls as one page,
  // with the toolbar and both panels pinned inside it. A phone has one column
  // and no room for the panels, so there the page simply scrolls.

  return (
    // Nothing horizontal to clear any more: the navigation is a bar across the
    // top and in the document flow, so this starts at the left edge. The bottom
    // nav on a phone is still fixed, and clearing it is this component's job —
    // screens never deal with it.
    <Flex
      align="stretch"
      gap={0}
      minH="100%"
      h={isMobile ? undefined : shellHeight(hasNav)}
      overflow={isMobile ? undefined : "hidden"}
      mb={isMobile && hasNav ? `${BOTTOM_NAV_HEIGHT}px` : 0}
    >
      {/*
        The one scroll container on a desktop. Everything sticky below anchors
        to this, it carries the toolbar's measured height, and
        `useInfiniteScroll` finds it as the sentinel's root.
      */}
      <Box
        ref={scrollRef}
        flex="1"
        minW={0}
        overflowY={isMobile ? "visible" : "auto"}
      >
        {toolbar ? (
          <Box
            ref={toolbarRef}
            position="sticky"
            top={0}
            zIndex={5}
            bg="bg"
            borderBottomWidth="1px"
            borderColor="border"
            px={isMobile ? 2 : `${PAGE_INSET_X}px`}
            py={isMobile ? 2 : 3}
          >
            {toolbar}
          </Box>
        ) : null}

        {/*
          No `gap`: the detail column carries its own leading gap so that it
          can close along with the width. The rail keeps a trailing margin
          instead, which is the same 24px it always had.
        */}
        <Flex
          align="flex-start"
          px={isMobile ? 0 : `${PAGE_INSET_X}px`}
          pt={isMobile ? 0 : `${ROW_INSET_TOP}px`}
        >
          {showRail ? (
            <SidePanel
              width={RAIL_WIDTH}
              maxH={maxPanelHeight}
              bare
              trailingGap={COLUMN_GAP}
            >
              {rail}
            </SidePanel>
          ) : null}

          <Box flex="1" minW={0}>
            <Box maxW={`${LIST_MAX_WIDTH}px`} w="100%" mx="auto" pb={16}>
              {children}
            </Box>
          </Box>

          {/*
            `bare` like the rail: the showtime panel pins its own header
            inside this scroller, and a sticky header needs a background and a
            padding of its own to pin against — it cannot borrow the wrapper's.
          */}
          {isDetailMounted ? (
            <SidePanel
              width={DETAIL_WIDTH}
              maxH={maxPanelHeight}
              bare
              collapsed={!isDetailOpen}
              pinned={pinnedColumn}
              panelRef={detailColumnRef}
              leadingGap={COLUMN_GAP}
            >
              {detail ?? lastDetail.current}
            </SidePanel>
          ) : null}
        </Flex>
      </Box>
    </Flex>
  )
}

export default FeedLayout
