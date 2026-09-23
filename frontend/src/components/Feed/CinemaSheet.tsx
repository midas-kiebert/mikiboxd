/**
 * The cinema selection sheet, opened from the rail's "Select cinemas".
 *
 * It is the app's cinema sheet (`CinemaFilterModal`) on a desktop: the same
 * title, the same "12 of 81 selected · Select all · Clear all", the same city
 * sections and checkmark chips, the same footer — "Save as preset" and "Manage
 * presets" over "Set as preferred cinemas" and "Apply" — in the same colours,
 * with Apply the filled one: it is what nearly every visit ends on, and saving
 * as preferred must never look like the way out.
 * What changes is where it opens and what the extra width is spent on.
 *
 * **Where.** Glued to the rail's right edge and laid over the showtimes, so
 * nothing on the page moves to make room for it. Everything outside the filters
 * is dimmed and stops responding — a click there, or Esc, closes the sheet —
 * while the rail itself stays live, which is why clicking a cinema set in the
 * rail while this is open loads that set into it.
 *
 * **When a choice lands.** On Apply, a click outside, or Esc: the same three
 * ways the app commits (its backdrop tap commits too). Until then the sheet
 * holds a draft, which is what lets "Clear all" mean something — committing an
 * empty selection means *every* cinema (`commitCinemaSelection`), so a sheet
 * that wrote on every click could never pass through zero on the way to two.
 *
 * **What the width is spent on: presets beside the cinemas.** A second panel
 * opens next to the sheet, so your presets and the cinemas they hold are on
 * screen together. "Save as preset" opens the same panel with the name field
 * at the top of it.
 *
 * Editing a preset loads its cinemas into the picker and its name into a field
 * above them, and the footer becomes Cancel / Save changes until you choose.
 */
import { Box, Flex, Portal, Text, chakra } from "@chakra-ui/react"
import {
  type ReactNode,
  type RefObject,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  MdBookmark,
  MdBookmarkAdd,
  MdCheck,
  MdClose,
  MdSearch,
  MdStarBorder,
  MdTune,
} from "react-icons/md"
import {
  ApiError,
  type CinemaPresetPublic,
  type CinemaPublic,
} from "shared/client"

import { CinemaChecklist } from "@/components/Feed/CinemaChecklist"
import { PresetManager, SavePresetForm } from "@/components/Feed/PresetManager"
import { cinemaMatchesQuery } from "@/features/showtimes/cinema-search"
import type { CinemaPresetState } from "@/features/showtimes/use-cinema-preset-state"

/** Wide enough for three chips a row; any wider and it stops being a sheet. */
const SHEET_WIDTH = 440
const SIDE_PANEL_WIDTH = 340
/** Room left between the sheet and the window's edges. */
const VIEWPORT_MARGIN = 12

/**
 * Matches `RAISED_Z_INDEX` in `FeedFilterRail.tsx`, which lifts the rail card
 * itself to the same level while the sheet is out. Above the root layout's own
 * notice banner (`zIndex={2000}` in `routes/__root.tsx`).
 *
 * The scrim sits one below so it dims the page without dimming the sheet or
 * the raised rail; both are rendered through a `Portal` (to `document.body`),
 * because a card in a showtime feed's grid sits in a `content-visibility:
 * auto` cell, and those always establish their own stacking context — nested
 * deep enough in the DOM, a `position: fixed` sheet painted *inside* the rail
 * lost to those cells regardless of z-index (the feed's `HoverCard` hit the
 * same wall once, for the same reason — see `card-parts.tsx`). Portalling
 * clear of the whole grid is what actually fixes it, not a bigger number.
 */
const SHEET_Z_INDEX = 2100

/**
 * The sheet's motion, in the showtime panel's spirit: it slides out from
 * behind the rail's edge (a clip at that edge, so it never crosses the rail)
 * while the page dims. Fast, and nothing inside it moves on its own. Closing
 * runs it back, quicker. Exported so the rail keeps the sheet mounted
 * for exactly as long as it takes to leave.
 */
const SHEET_ENTER_MS = 170
export const SHEET_EXIT_MS = 140
const SHEET_ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
const SHEET_EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)"

/**
 * Mounting the sheet is the expensive part (a chip per cinema), and a slide
 * started in the same frame loses its opening frames to that first paint — it
 * appears already halfway out. So the slide waits, parked at its start, until
 * the sheet has been painted once, then runs (see `usePrimedSlide`).
 */
const usePrimedSlide = (refs: RefObject<HTMLElement | null>[]) => {
  // Straight onto the elements rather than through state: a re-render of the
  // sheet costs as much as mounting it did, which is the very delay this
  // exists to keep out of the slide.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount; the refs are stable objects, only the array around them is new each render
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        for (const ref of refs) {
          if (ref.current) ref.current.style.animationPlayState = "running"
        }
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])
}

/**
 * A panel that slides away rather than vanishing: `value` as given while it
 * is set, and its last value for `SHEET_EXIT_MS` after it clears, flagged as
 * leaving, so the panel can play its exit before it unmounts.
 */
const useLeavingValue = <T,>(value: T | null) => {
  const [last, setLast] = useState(value)
  if (value !== null && value !== last) setLast(value)
  const isLeaving = value === null && last !== null
  useEffect(() => {
    if (!isLeaving) return
    const timer = setTimeout(() => setLast(null), SHEET_EXIT_MS)
    return () => clearTimeout(timer)
  }, [isLeaving])
  return { shown: value ?? last, isLeaving }
}

/** A sheet's slide, in or out; `--mk-sheet-from` sets how far off it starts. */
const slide = (isLeaving: boolean) =>
  isLeaving
    ? `sheet-out ${SHEET_EXIT_MS}ms ${SHEET_EXIT_EASING} both`
    : `sheet-in ${SHEET_ENTER_MS}ms ${SHEET_ENTER_EASING} both`

const Pressable = chakra("button")
const SearchInput = chakra("input")

type Geometry = { left: number; top: number; height: number; maxWidth: number }

/**
 * Where the sheet goes: against the rail's right edge, from the rail's top (or
 * the top of the window, if the rail starts above it) to the window's bottom.
 * Fixed rather than absolute, so it neither scrolls away nor grows the page.
 */
const useAnchoredGeometry = (
  anchorRef: RefObject<HTMLElement | null>,
): Geometry | null => {
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const top = Math.max(rect.top, VIEWPORT_MARGIN)
      // One pixel over the rail's border, so the two read as one piece.
      const left = rect.right - 1
      setGeometry({
        left,
        top,
        height: window.innerHeight - top - VIEWPORT_MARGIN,
        maxWidth: window.innerWidth - left - VIEWPORT_MARGIN,
      })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [anchorRef])
  return geometry
}

/**
 * The page behind stays put while the sheet is open. A scroll over the scrim
 * would otherwise reach the feed's scroller and move the rail out from under
 * the sheet glued to it. Native and non-passive, because React's wheel
 * listener is passive and cannot cancel.
 */
const useBlockScroll = (ref: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const block = (event: Event) => event.preventDefault()
    element.addEventListener("wheel", block, { passive: false })
    element.addEventListener("touchmove", block, { passive: false })
    return () => {
      element.removeEventListener("wheel", block)
      element.removeEventListener("touchmove", block)
    }
  }, [ref])
}

const useEscape = (onEscape: () => void) => {
  const latest = useRef(onEscape)
  latest.current = onEscape
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
}

/* ── Pieces, in the app's styles ─────────────────────────────────────────── */

const IconButton = ({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) => (
  <Pressable
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    display="flex"
    alignItems="center"
    justifyContent="center"
    boxSize="30px"
    borderRadius="full"
    bg="transparent"
    color="fg.muted"
    cursor="pointer"
    _hover={{ bg: "bg.subtle", color: "fg" }}
  >
    {children}
  </Pressable>
)

const SheetHeader = ({
  title,
  actions,
  onClose,
}: {
  title: string
  /** Rare actions that earn a spot beside Close rather than a whole footer row. */
  actions?: ReactNode
  onClose: () => void
}) => (
  <Flex align="center" gap="2px" px="14px" pt="12px" pb="8px" flexShrink={0}>
    <Text flex="1" fontSize="17px" fontWeight="700" color="fg" pl="6px">
      {title}
    </Text>
    {actions}
    <IconButton label="Close" onClick={onClose}>
      <MdClose size={19} />
    </IconButton>
  </Flex>
)

/**
 * An icon-only action in the header, for something reached for once or twice
 * ever — saving or managing cinema presets — beside the frequent close. Green
 * when it has something to do (a selection worth saving), muted otherwise;
 * never a whole footer row, which would put a rare action at the same weight
 * as "Set as preferred cinemas", the one people actually come back for.
 */
const HeaderIconButton = ({
  label,
  onClick,
  isHighlighted = false,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  isHighlighted?: boolean
  disabled?: boolean
  children: ReactNode
}) => (
  <Pressable
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    display="flex"
    alignItems="center"
    justifyContent="center"
    boxSize="30px"
    borderRadius="full"
    bg="transparent"
    color={isHighlighted ? "app.tint" : "fg.muted"}
    cursor={disabled ? "default" : "pointer"}
    opacity={disabled ? 0.4 : 1}
    _hover={disabled ? undefined : { bg: "bg.subtle", color: "fg" }}
  >
    {children}
  </Pressable>
)

/**
 * "Set as preferred cinemas", in the app's two states. Outlined, never filled:
 * it sits beside Apply, and the filled button is the one people should reach
 * for without thinking.
 */
const PreferredButton = ({
  isPreferred,
  canSave,
  onClick,
}: {
  isPreferred: boolean
  canSave: boolean
  onClick: () => void
}) => (
  <Pressable
    type="button"
    onClick={onClick}
    disabled={!canSave}
    flex="1"
    minW={0}
    display="flex"
    alignItems="center"
    justifyContent="center"
    gap="6px"
    px="14px"
    py="10px"
    borderRadius="12px"
    borderWidth="1.5px"
    borderColor={canSave ? "app.green.border" : "app.divider"}
    bg="transparent"
    color={canSave ? "app.green.secondary" : "fg.muted"}
    fontSize="13px"
    fontWeight="600"
    cursor="pointer"
    opacity={canSave ? 1 : 0.5}
    _hover={canSave ? { bg: "app.green.primary" } : undefined}
    _disabled={{ cursor: "default" }}
  >
    {isPreferred ? <MdCheck size={17} /> : <MdStarBorder size={17} />}
    <Box as="span" truncate position="relative" top="1px">
      {isPreferred
        ? "These are your preferred cinemas"
        : "Set as preferred cinemas"}
    </Box>
  </Pressable>
)

const PrimaryButton = ({
  label,
  onClick,
  disabled = false,
  stretch = false,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  stretch?: boolean
}) => (
  <Pressable
    type="button"
    onClick={onClick}
    disabled={disabled}
    flex={stretch ? "1" : undefined}
    px="28px"
    py="10px"
    borderRadius="12px"
    borderWidth="1.5px"
    borderColor="app.tint"
    bg="app.tint"
    color="app.pillActiveText"
    fontSize="13px"
    fontWeight="700"
    cursor="pointer"
    _hover={{ filter: "brightness(1.05)" }}
    _disabled={{ opacity: 0.5, cursor: "default" }}
  >
    {label}
  </Pressable>
)

const SecondaryButton = ({
  label,
  onClick,
}: { label: string; onClick: () => void }) => (
  <Pressable
    type="button"
    onClick={onClick}
    flex="1"
    px="14px"
    py="10px"
    borderRadius="12px"
    borderWidth="1.5px"
    borderColor="app.divider"
    bg="bg.panel"
    color="fg.muted"
    fontSize="13px"
    fontWeight="600"
    cursor="pointer"
    _hover={{ color: "fg" }}
  >
    {label}
  </Pressable>
)

const Footer = ({ children }: { children: ReactNode }) => (
  <Flex
    direction="column"
    gap="8px"
    px="16px"
    pt="10px"
    pb="14px"
    borderTopWidth="1px"
    borderColor="app.divider"
    bg="bg.muted"
    flexShrink={0}
  >
    {children}
  </Flex>
)

/**
 * The cinema picker: search, the count and its two actions, and the
 * double-click hint stay put at the top; only the city list scrolls under
 * them, so the way to search or select-all is never something you have to
 * scroll back up for. *
 * Memoised: it is a chip per cinema, and the sheet re-renders on its way out
 * (`isLeaving`) with nothing here changed — a render that would otherwise
 * delay the slide it is starting.
 */
const Picker = memo(
  ({
    cinemas,
    draftIds,
    setDraftIds,
    searchRef,
  }: {
    cinemas: CinemaPublic[]
    draftIds: number[]
    setDraftIds: (ids: number[]) => void
    searchRef: RefObject<HTMLInputElement | null>
  }) => {
    const [query, setQuery] = useState("")
    const selected = useMemo(() => new Set(draftIds), [draftIds])
    const matches = useMemo(
      () => cinemas.filter((cinema) => cinemaMatchesQuery(cinema, query)),
      [cinemas, query],
    )
    const isSearching = query.trim().length > 0
    // While searching, the two header actions act on what the search found —
    // "Select all" over three results selecting eighty-one would be a surprise.
    const scope = isSearching ? matches : cinemas
    const scopeIds = scope.map((cinema) => cinema.id)
    const allInScope =
      scopeIds.length > 0 && scopeIds.every((id) => selected.has(id))
    const anyInScope = scopeIds.some((id) => selected.has(id))

    const add = (ids: readonly number[]) =>
      setDraftIds([...new Set([...draftIds, ...ids])])
    const drop = (ids: readonly number[]) => {
      const dropping = new Set(ids)
      setDraftIds(draftIds.filter((id) => !dropping.has(id)))
    }
    const toggle = (id: number) => (selected.has(id) ? drop([id]) : add([id]))

    return (
      <Box flex="1" minH={0} display="flex" flexDirection="column">
        <Box px="16px" pt="4px" flexShrink={0}>
          <Flex
            align="center"
            gap="8px"
            h="38px"
            px="12px"
            mb="12px"
            borderRadius="10px"
            borderWidth="1px"
            borderColor="app.pillBorder"
            bg="app.searchBackground"
            _focusWithin={{ borderColor: "app.tint" }}
          >
            <Box color="fg.muted" display="flex" flexShrink={0}>
              <MdSearch size={18} />
            </Box>
            <SearchInput
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cinemas"
              aria-label="Search cinemas"
              flex="1"
              minW={0}
              bg="transparent"
              border="none"
              outline="none"
              fontSize="14px"
              color="fg"
            />
            {query ? (
              <Pressable
                type="button"
                aria-label="Clear the search"
                onClick={() => setQuery("")}
                display="flex"
                bg="transparent"
                color="fg.muted"
                cursor="pointer"
              >
                <MdClose size={16} />
              </Pressable>
            ) : null}
          </Flex>

          <Flex align="center" gap="14px" mb="4px">
            <Text flex="1" fontSize="13px" fontWeight="600" color="fg.muted">
              {isSearching
                ? `${matches.length} match${matches.length === 1 ? "" : "es"} · ${draftIds.length} selected`
                : `${draftIds.length} of ${cinemas.length} selected`}
            </Text>
            {!allInScope && scope.length > 0 ? (
              <Pressable
                type="button"
                onClick={() => add(scopeIds)}
                bg="transparent"
                color="app.tint"
                fontSize="13px"
                fontWeight="700"
                cursor="pointer"
              >
                Select all
              </Pressable>
            ) : null}
            {anyInScope ? (
              <Pressable
                type="button"
                onClick={() => drop(scopeIds)}
                bg="transparent"
                color="app.tint"
                fontSize="13px"
                fontWeight="700"
                cursor="pointer"
              >
                Clear all
              </Pressable>
            ) : null}
          </Flex>
          <Text fontSize="11px" color="fg.subtle" mb="10px">
            Double-click a cinema to select only that one.
          </Text>
        </Box>

        <Box
          flex="1"
          minH={0}
          overflowY="auto"
          overscrollBehavior="contain"
          px="16px"
          pb="16px"
        >
          {matches.length === 0 ? (
            <Text fontSize="13px" color="fg.muted" py="16px">
              No cinema matches “{query}”.
            </Text>
          ) : (
            <CinemaChecklist
              cinemas={matches}
              selectedIds={selected}
              onToggle={toggle}
              onOnly={(id) => setDraftIds([id])}
              onSelect={add}
              onDeselect={drop}
            />
          )}
        </Box>
      </Box>
    )
  },
)

/* ── The sheet ──────────────────────────────────────────────────────────── */

type Editing = {
  preset: CinemaPresetPublic
  name: string
  error: string | null
  /** The selection before the edit, which Cancel puts back. */
  before: number[]
}

export const CinemaSheet = ({
  anchorRef,
  cinemas,
  draftIds,
  setDraftIds,
  isSignedIn,
  presetState,
  onSavePreferred,
  onPromotePreset,
  onApply,
  isLeaving = false,
}: {
  /** The rail's card, which the sheet is glued to. */
  anchorRef: RefObject<HTMLElement | null>
  cinemas: CinemaPublic[]
  draftIds: number[]
  setDraftIds: (ids: number[]) => void
  isSignedIn: boolean
  presetState: CinemaPresetState
  /** "Set as preferred cinemas" — may ask first; see `usePreferredCinemasSave`. */
  onSavePreferred: (cinemaIds: number[]) => void
  /** The manage list's "Set as preferred cinemas" — may ask first, too. */
  onPromotePreset: (preset: CinemaPresetPublic) => void
  /** Commit these cinemas and close. */
  onApply: (cinemaIds: number[]) => void
  /** Already applied and on its way out: plays the exit and takes no input. */
  isLeaving?: boolean
}) => {
  const geometry = useAnchoredGeometry(anchorRef)
  const scrimRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useBlockScroll(scrimRef)
  usePrimedSlide([scrimRef, sheetRef])

  const [sidePanel, setSidePanel] = useState<"manage" | "save" | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  // Editing a preset takes the panel's place, so it leaves then too.
  const panel = useLeavingValue(editing ? null : sidePanel)
  const isPanelLeaving = isLeaving || panel.isLeaving

  // Straight to the search: on a desktop, typing a name is the fastest way to
  // a cinema, and the sheet opening is the request to pick one.
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true })
  }, [])

  /** Closing mid-edit abandons the edit, so the selection that lands is the one from before it. */
  const close = () => {
    if (!isLeaving) onApply(editing ? editing.before : draftIds)
  }
  useEscape(close)

  const namedMatch = presetState.namedPresetFor(draftIds)
  const isPreferred = presetState.isPreferred(draftIds)
  const canSaveAsPreset =
    isSignedIn && draftIds.length > 0 && namedMatch === null
  const canSavePreferred = draftIds.length > 0 && !isPreferred

  const startEdit = (preset: CinemaPresetPublic) => {
    setEditing({ preset, name: preset.name, error: null, before: draftIds })
    setDraftIds([...preset.cinema_ids])
  }

  const cancelEdit = () => {
    if (!editing) return
    setDraftIds(editing.before)
    setEditing(null)
  }

  const saveEdit = async () => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name || draftIds.length === 0) return
    try {
      await presetState.updatePreset({
        presetId: editing.preset.id,
        name,
        cinemaIds: draftIds,
      })
      setEditing(null)
    } catch (caught) {
      const error =
        caught instanceof ApiError && caught.status === 409
          ? "You already have a preset with that name."
          : "Could not save this preset. Please try again."
      setEditing((current) => (current ? { ...current, error } : current))
    }
  }

  if (!geometry) return null

  const sheetWidth = Math.min(SHEET_WIDTH, geometry.maxWidth)

  const editBanner = editing ? (
    <Box px="16px" pb="10px" flexShrink={0}>
      <Box
        borderRadius="12px"
        borderWidth="1px"
        borderColor="app.green.border"
        bg="app.green.primary"
        p="10px"
      >
        <Text
          fontSize="11px"
          fontWeight="700"
          color="app.green.secondary"
          textTransform="uppercase"
          letterSpacing="0.6px"
          mb="6px"
        >
          Preset name
        </Text>
        <SearchInput
          value={editing.name}
          onChange={(event) =>
            setEditing((current) =>
              current
                ? { ...current, name: event.target.value, error: null }
                : current,
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveEdit()
          }}
          placeholder="Preset name"
          maxLength={80}
          w="100%"
          h="34px"
          px="10px"
          borderRadius="8px"
          borderWidth="1px"
          borderColor="app.pillBorder"
          bg="app.searchBackground"
          color="fg"
          fontSize="14px"
          outline="none"
          _focusVisible={{ borderColor: "app.tint" }}
        />
        {editing.error ? (
          <Text fontSize="12px" color="app.red.secondary" mt="6px">
            {editing.error}
          </Text>
        ) : null}
      </Box>
    </Box>
  ) : null

  // "Save as preset" and "Manage presets" live in the header now, not here —
  // once or twice ever isn't worth a footer row. Closing (X, Esc, outside
  // click) already applies the draft, but Apply is still spelled out, and
  // filled, so the obvious button is the one that changes nothing on the
  // account. A guest's preferred set is kept in their browser instead.
  const footer = editing ? (
    <Footer>
      <Flex gap="8px">
        <SecondaryButton label="Cancel" onClick={cancelEdit} />
        <PrimaryButton
          label={presetState.isUpdating ? "Saving…" : "Save changes"}
          onClick={() => void saveEdit()}
          disabled={
            !editing.name.trim() ||
            draftIds.length === 0 ||
            presetState.isUpdating
          }
          stretch
        />
      </Flex>
    </Footer>
  ) : (
    <Footer>
      <Flex gap="8px" align="stretch">
        <PreferredButton
          isPreferred={isPreferred}
          canSave={canSavePreferred}
          onClick={() => onSavePreferred(draftIds)}
        />
        <PrimaryButton label="Apply" onClick={close} />
      </Flex>
    </Footer>
  )

  const surface = {
    position: "fixed" as const,
    top: `${geometry.top}px`,
    h: `${geometry.height}px`,
    display: "flex",
    flexDirection: "column" as const,
    bg: "bg.muted",
    borderWidth: "1px",
    borderColor: "border",
    boxShadow: "0 18px 50px rgba(0, 0, 0, 0.28)",
    overflow: "hidden",
  }

  return (
    <Portal>
      {/* Dims the page and blocks it, just below the sheet and the raised
          rail. Not the rail's own stacking context any more (see
          `SHEET_Z_INDEX`), so this is an absolute level rather than -1. */}
      <Box
        ref={scrimRef}
        position="fixed"
        inset={0}
        zIndex={SHEET_Z_INDEX - 1}
        // Darker in dark mode: half-black over a near-black page is barely a
        // change, and the dim is what says "the rest of the page is off".
        bg={{ base: "blackAlpha.500", _dark: "blackAlpha.700" }}
        cursor="pointer"
        onClick={close}
        pointerEvents={isLeaving ? "none" : undefined}
        animation={
          isLeaving
            ? `scrim-out ${SHEET_EXIT_MS}ms ease both`
            : `scrim-in ${SHEET_ENTER_MS}ms ease both`
        }
        animationPlayState="paused"
        _motionReduce={{ animation: "none" }}
        aria-hidden
      />

      {/* Everything left of the rail's right edge is clipped away, so the
          sheets slide out from *under* the rail rather than across it. A
          static clip on a wrapper, not on the sheets themselves, so it stays
          put while they move. */}
      <Box
        position="fixed"
        inset={0}
        zIndex={SHEET_Z_INDEX}
        clipPath={`inset(0 0 0 ${geometry.left}px)`}
        pointerEvents="none"
      >
        <Box
          ref={sheetRef}
          role="dialog"
          aria-label="Cinemas"
          {...surface}
          left={`${geometry.left}px`}
          w={`${sheetWidth}px`}
          // Above the presets panel, which slides out from behind it.
          zIndex={2}
          borderTopRightRadius="14px"
          borderBottomRightRadius="14px"
          pointerEvents={isLeaving ? "none" : "auto"}
          animation={slide(isLeaving)}
          animationPlayState="paused"
          _motionReduce={{ animation: "none" }}
        >
          <SheetHeader
            title="Cinemas"
            onClose={close}
            actions={
              isSignedIn && !editing ? (
                <>
                  <HeaderIconButton
                    label={namedMatch ? "Already a preset" : "Save as preset"}
                    isHighlighted={canSaveAsPreset}
                    disabled={!canSaveAsPreset}
                    onClick={() => setSidePanel("save")}
                  >
                    {namedMatch ? (
                      <MdBookmark size={18} />
                    ) : (
                      <MdBookmarkAdd size={18} />
                    )}
                  </HeaderIconButton>
                  <HeaderIconButton
                    label="Manage presets"
                    isHighlighted={sidePanel === "manage"}
                    onClick={() =>
                      setSidePanel((current) =>
                        current === "manage" ? null : "manage",
                      )
                    }
                  >
                    <MdTune size={18} />
                  </HeaderIconButton>
                </>
              ) : undefined
            }
          />
          {editBanner}
          <Picker
            cinemas={cinemas}
            draftIds={draftIds}
            setDraftIds={setDraftIds}
            searchRef={searchRef}
          />
          {footer}
        </Box>

        {panel.shown ? (
          <Box
            role="dialog"
            aria-label={
              panel.shown === "save" ? "Save as preset" : "Manage presets"
            }
            {...surface}
            left={`${geometry.left + sheetWidth - 1}px`}
            w={`${Math.min(SIDE_PANEL_WIDTH, Math.max(0, geometry.maxWidth - sheetWidth))}px`}
            zIndex={1}
            borderRadius="14px"
            pointerEvents={isPanelLeaving ? "none" : "auto"}
            // In and out from behind the sheet on its own (its shadow's reach
            // further, or that would show beside the sheet); back under the
            // rail with the sheet on close, which is its own width *and* the
            // sheet's.
            css={{
              "--mk-sheet-from": isLeaving
                ? `calc(-100% - ${sheetWidth + 64}px)`
                : "calc(-100% - 64px)",
            }}
            animation={slide(isPanelLeaving)}
            _motionReduce={{ animation: "none" }}
          >
            <SheetHeader
              title="Manage presets"
              onClose={() => setSidePanel(null)}
            />
            {panel.shown === "save" ? (
              <Box px="16px" pb="12px" flexShrink={0}>
                <Box
                  borderRadius="12px"
                  borderWidth="1px"
                  borderColor="app.divider"
                  bg="bg.panel"
                  p="12px"
                >
                  <SavePresetForm
                    presetState={presetState}
                    cinemaIds={draftIds}
                    onDone={() => setSidePanel("manage")}
                  />
                </Box>
              </Box>
            ) : null}
            <Box
              flex="1"
              minH={0}
              overflowY="auto"
              overscrollBehavior="contain"
              px="16px"
              pt="4px"
              pb="16px"
            >
              <PresetManager
                presetState={presetState}
                draftIds={draftIds}
                onApply={(cinemaIds) => setDraftIds([...cinemaIds])}
                onEdit={startEdit}
                onMakePreferred={onPromotePreset}
              />
            </Box>
          </Box>
        ) : null}
      </Box>
    </Portal>
  )
}
