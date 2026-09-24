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
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import {
  RAIL_STRIP_GAP,
  RAIL_STRIP_WIDTH,
  RailCollapseHandle,
  RailFoldedProvider,
  RailStrip,
  useRailCollapsed,
} from "@/components/Feed/RailCollapse"
import { usePublishFeedListCenter } from "@/components/Feed/feed-search-slot"
import {
  type PinnedColumn,
  detailCardStyle,
  detailColumnStyle,
  useDetailColumn,
} from "@/components/Feed/useDetailColumn"
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
 * How far below the toolbar the two floating cards start — level with the
 * top of the list, so a card's top edge and the first row's top edge line up
 * rather than the panels hanging lower than the cards beside them.
 *
 * It is also the offset they pin at, measured from the toolbar's own bottom
 * edge, so the inset a card has while the page is at rest is the one it keeps
 * while pinned. Those being one number is what stops a card jumping on the
 * first scroll.
 */
const PANEL_INSET_TOP = ROW_INSET_TOP

/** How close a pinned card may come to the bottom of the viewport. */
const PANEL_INSET_BOTTOM = 16

/** Between the columns. */
const COLUMN_GAP = 24

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
  /**
   * For a grid of cards rather than a list of rows. The list takes the whole
   * column instead of `LIST_MAX_WIDTH`, and the detail column is always there
   * at full width — empty until something is selected — rather than opening.
   *
   * An opening column narrows the list, and a narrower grid reflows: fewer
   * columns, every card moved, the one just clicked often carried out of
   * view. It also reflowed on every frame of the column's animation, which
   * made opening the panel the slowest thing on the page. With the space
   * held, selecting a card changes nothing about where anything is.
   */
  grid?: boolean
  /**
   * A grid with nothing docked beside it: the list takes the whole column,
   * like `grid`, but no detail column is reserved at all.
   *
   * For a feed that has no panel to open. The films feed is one — a film's
   * detail is its own page — so holding a fifth of the window empty next to
   * it would be holding it for something that never arrives.
   */
  fillWidth?: boolean
  /**
   * The narrowest the list may get beside a full rail — one card, on the
   * ticket wall. Below it the rail folds to its strip by itself, since the
   * detail column is the one thing on the page that cannot give up its room
   * (the showtime panel opens in it). 0 never folds it.
   */
  minListWidth?: number
  /** Shown as a count on the collapsed rail, so a narrowed feed looks it. */
  activeFilterCount?: number
  /**
   * Under the rail card, in the same column: the ticket wall's tickets-per-row
   * control. Asked for `compact` when the rail is folded to its strip.
   */
  railFooter?: (variant: "full" | "compact") => ReactNode
}

/**
 * How a panel's content asks to be lifted above a page-wide scrim: the filter
 * rail does while its cinema sheet is out, so it stays bright beside it. The
 * content raises itself, but a floating panel's own `zIndex` is a stacking
 * context that would keep it underneath, so the panel follows it up.
 */
export const RAISED_PANEL_ATTRIBUTE = "data-raise-panel"
/** Above the root layout's notice banner (2000); the cinema sheet's level. */
export const RAISED_PANEL_Z_INDEX = 2100

/** A responsive width, as the margin that cancels it — see `floating`. */
const negate = (width: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(width).map(([key, value]) => [key, `-${value}`]),
  )

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
  floating = false,
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
  /**
   * Takes no room in the row: a trailing margin of minus its own width lets
   * the list start where it starts, so the panel floats over the list's left
   * edge. Still sticky, still its real width. The folded rail opens this way
   * when there is no room to dock it.
   */
  floating?: boolean
  children: ReactNode
}) => (
  <Box
    as="aside"
    ref={panelRef}
    data-feed-side-panel=""
    {...detailColumnStyle(width, leadingGap, { isOpen: !collapsed, pinned })}
    me={floating ? negate(width) : `${trailingGap}px`}
    zIndex={floating ? 4 : undefined}
    css={
      floating
        ? {
            [`&:has([${RAISED_PANEL_ATTRIBUTE}])`]: {
              zIndex: RAISED_PANEL_Z_INDEX,
            },
          }
        : undefined
    }
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
    borderRadius={bare && !floating ? undefined : "md"}
    boxShadow={floating ? "lg" : bare ? undefined : "sm"}
    p={bare ? 0 : 3}
  >
    <Box {...detailCardStyle(width, !collapsed)}>{children}</Box>
  </Box>
)

const FeedLayout = ({
  rail,
  toolbar,
  children,
  detail,
  hasNav = true,
  grid = false,
  fillWidth = false,
  minListWidth = 0,
  activeFilterCount = 0,
  railFooter,
}: FeedLayoutProps) => {
  const isMobile = useIsMobile()
  const showRail = Boolean(rail) && !isMobile
  const maxPanelHeight = panelMaxHeight(hasNav)

  /**
   * The detail column opens and closes rather than appearing and vanishing —
   * see `useDetailColumn` for why that takes a state machine rather than a
   * class toggle.
   *
   * `lastDetail` is what the close animates out: by then the caller has already
   * stopped passing a panel. A ref rather than state because writing it is
   * idempotent and must not cause a render of its own — the node identity
   * changes every render, so a state write here would never settle.
   */
  // A grid keeps its column open for good, so it never enters the machine;
  // a full-width feed has no detail column to open at all.
  const hasDetail = Boolean(detail) && !isMobile && !grid && !fillWidth
  const lastDetail = useRef<ReactNode>(null)
  if (detail) lastDetail.current = detail
  const {
    isMounted: isDetailMounted,
    isOpen: isDetailOpen,
    pinned: pinnedColumn,
    columnRef: detailColumnRef,
  } = useDetailColumn(hasDetail)

  const scrollRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const railRulerRef = useRef<HTMLDivElement>(null)
  // The nav's search field centres itself over this.
  const listRef = useRef<HTMLDivElement>(null)
  usePublishFeedListCenter(listRef)
  const stripRef = useRef<HTMLDivElement>(null)
  const floatingRailRef = useRef<HTMLDivElement>(null)

  /**
   * The rail folds to a strip when the reader folds it, and by itself when
   * the list beside a full rail would be narrower than `minListWidth`.
   *
   * Worked out from the row, a hidden ruler at the rail's full width, and the
   * detail column — never from the list itself, which is exactly what changes
   * when the rail folds, so measuring it would flip back and forth. None of
   * those move when the rail does, so the answer holds still once acted on.
   *
   * Folded for lack of room, the strip opens the rail *over* the list
   * (`floating`) rather than docking it back, which would only squeeze the
   * list again; a click on the page outside it puts it away. Folded by
   * choice, with room to spare, the strip docks it again.
   */
  const [isRailFoldedByReader, setRailFoldedByReader] = useRailCollapsed()
  const [isRailTight, setIsRailTight] = useState(false)
  const [isRailFloating, setIsRailFloating] = useState(false)
  const isRailFolded = isRailFoldedByReader || isRailTight
  const measuresRailRoom = showRail && minListWidth > 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: the detail column is a ref read live at measure time; it is not a trigger
  useLayoutEffect(() => {
    const row = rowRef.current
    const ruler = railRulerRef.current
    if (!measuresRailRoom || !row || !ruler) {
      setIsRailTight(false)
      return
    }
    const update = () => {
      const column = detailColumnRef.current
      const detailRoom = column ? column.offsetWidth + COLUMN_GAP : 0
      const listRoom =
        row.clientWidth -
        2 * PAGE_INSET_X -
        ruler.offsetWidth -
        COLUMN_GAP -
        detailRoom
      setIsRailTight(listRoom < minListWidth)
    }
    update()
    // The ruler and the column too: their widths step with the breakpoint.
    const observer = new ResizeObserver(update)
    observer.observe(row)
    observer.observe(ruler)
    if (detailColumnRef.current) observer.observe(detailColumnRef.current)
    return () => observer.disconnect()
  }, [measuresRailRoom, minListWidth])

  // Room again, or folded away: nothing is left floating over the list.
  useEffect(() => {
    if (!isRailTight) setIsRailFloating(false)
  }, [isRailTight])

  // A click elsewhere on the page puts the floating rail away. Only clicks
  // inside this layout count: the rail's own sheets and menus are portalled
  // to the body, and picking something in them must not close it.
  useEffect(() => {
    if (!isRailFloating) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!scrollRef.current?.contains(target)) return
      if (floatingRailRef.current?.contains(target)) return
      if (stripRef.current?.contains(target)) return
      setIsRailFloating(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [isRailFloating])

  const toggleRailFromStrip = useCallback(() => {
    if (isRailTight) {
      setIsRailFloating((current) => !current)
      return
    }
    setRailFoldedByReader(false)
  }, [isRailTight, setRailFoldedByReader])
  const foldRail = useCallback(
    () => setRailFoldedByReader(true),
    [setRailFoldedByReader],
  )

  // The docked rail's scroll lane, which its card ends short of — for the
  // collapse handle to sit on the card's edge rather than the column's.
  const dockedRailRef = useRef<HTMLDivElement>(null)
  const [railLane, setRailLane] = useState(0)
  const isRailDocked = showRail && !isRailFolded
  useLayoutEffect(() => {
    const aside = dockedRailRef.current
    if (!isRailDocked || !aside) return
    const update = () => setRailLane(aside.offsetWidth - aside.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(aside)
    return () => observer.disconnect()
  }, [isRailDocked])

  const railWithFooter = (
    <>
      {rail}
      {/* A hair of padding, or the scrolling column clips the card's shadow. */}
      {railFooter ? (
        <Box mt={3} pb="2px">
          {railFooter("full")}
        </Box>
      ) : null}
    </>
  )

  // Publish the toolbar's height for the panels to pin below. A layout effect
  // rather than an ordinary one, so the first paint already has the real number
  // and no card is drawn under the bar and then moved.
  //
  // Keyed on whether there is a toolbar at all: a cinema's or friend's header
  // arrives once its subject loads, on a feed that had no toolbar at mount, and
  // measuring only at mount left the panels pinning at 0 — sliding up under
  // the header with the page until their bottoms came into view.
  const hasToolbar = Boolean(toolbar)
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasToolbar is the trigger; the toolbar node is read through its ref
  useLayoutEffect(() => {
    const bar = toolbarRef.current
    const scroller = scrollRef.current
    if (!scroller) return
    if (!bar) {
      scroller.style.setProperty(TOOLBAR_HEIGHT_VAR, "0px")
      return
    }

    const publish = () =>
      scroller.style.setProperty(TOOLBAR_HEIGHT_VAR, `${bar.offsetHeight}px`)

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [hasToolbar])

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
          ref={rowRef}
          position="relative"
          align="flex-start"
          px={isMobile ? 0 : `${PAGE_INSET_X}px`}
          pt={isMobile ? 0 : `${ROW_INSET_TOP}px`}
        >
          {/* The rail's full width, measured while it is folded too. */}
          {measuresRailRoom ? (
            <Box
              ref={railRulerRef}
              w={RAIL_WIDTH}
              h={0}
              position="absolute"
              visibility="hidden"
              pointerEvents="none"
              aria-hidden
            />
          ) : null}

          {showRail && !isRailFolded ? (
            <>
              <SidePanel
                width={RAIL_WIDTH}
                maxH={maxPanelHeight}
                bare
                trailingGap={COLUMN_GAP}
                panelRef={dockedRailRef}
              >
                {railWithFooter}
              </SidePanel>
              <RailCollapseHandle
                gap={COLUMN_GAP}
                inset={railLane}
                top={PANEL_STICKY_TOP}
                onCollapse={foldRail}
              />
            </>
          ) : null}

          {showRail && isRailFolded ? (
            <SidePanel
              width={RAIL_STRIP_WIDTH}
              maxH={maxPanelHeight}
              bare
              trailingGap={RAIL_STRIP_GAP}
            >
              <RailStrip
                stripRef={stripRef}
                activeFilterCount={activeFilterCount}
                isOpen={isRailFloating}
                onToggle={toggleRailFromStrip}
                footer={railFooter?.("compact")}
              />
            </SidePanel>
          ) : null}

          {showRail && isRailFolded && isRailFloating ? (
            <SidePanel
              width={RAIL_WIDTH}
              maxH={maxPanelHeight}
              bare
              floating
              panelRef={floatingRailRef}
            >
              {/* No footer: the strip beside it already has it, compact. */}
              {rail}
            </SidePanel>
          ) : null}

          <Box flex="1" minW={0}>
            <Box
              ref={listRef}
              maxW={grid || fillWidth ? undefined : `${LIST_MAX_WIDTH}px`}
              w="100%"
              mx="auto"
              pb={16}
            >
              <RailFoldedProvider value={showRail && isRailFolded}>
                {children}
              </RailFoldedProvider>
            </Box>
          </Box>

          {/*
            `bare` like the rail: the showtime panel pins its own header
            inside this scroller, and a sticky header needs a background and a
            padding of its own to pin against — it cannot borrow the wrapper's.
          */}
          {fillWidth ? null : grid && !isMobile ? (
            <SidePanel
              width={DETAIL_WIDTH}
              maxH={maxPanelHeight}
              bare
              panelRef={detailColumnRef}
              leadingGap={COLUMN_GAP}
            >
              {detail}
            </SidePanel>
          ) : isDetailMounted ? (
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
