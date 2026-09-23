/**
 * The vocabulary the filter rail is built from: a section, a pill, a tri-state
 * row, a sub-heading.
 *
 * Every one of these is the app's control rendered for a mouse. The metrics are
 * lifted from `mobile/components/filters` — the section heading's 11px
 * uppercase with its 0.6 tracking, the pill's 13px/500 on a fully rounded
 * hairline — so the two clients read as the same product rather than as a site
 * and an app that happen to filter the same things.
 *
 * The ground is the ordinary panel card, so the ordinary neutrals are what
 * these are drawn in — `fg` and `fg.muted` for ink, `border` for hairlines,
 * `app.pill*` for the chips, all of them already tuned against exactly this
 * surface. Two earlier passes gave the rail a surface of its own (the brand
 * tint, then a green-cast "ticket stock" with a bespoke `rail.*` palette to
 * sit on it) and both read as a coloured slab beside the plainly-carded detail
 * panel across the feed; the palette went with the tint.
 *
 * Two shape rules, both the app's:
 *   - A pill is *state*: fully round.
 *   - A button is an *action*: squared, at `PRESET_BUTTON_RADIUS`. A preset
 *     therefore never renders as selected, however exactly the filters match
 *     it — highlighting the matching one is the obvious "improvement" that puts
 *     actions straight back into the selection family.
 *
 * Everything pressable here is `chakra("button")` rather than `Box as="button"`:
 * `as` swaps the tag without swapping the prop types, so `type="button"` on a
 * Box is a tsc error waiting at check time.
 */
import { Box, Flex, Text, chakra } from "@chakra-ui/react"
import { type ChangeEvent, type ReactNode, useState } from "react"
import { FiChevronDown } from "react-icons/fi"
import { MdBlock, MdClose } from "react-icons/md"
import { PRESET_BUTTON_RADIUS } from "shared/filters/filter-control-metrics"

const RailButton = chakra("button")
const RailTextInput = chakra("input")

/** Matches the app's in-modal pill: 12/6 padding on a 13px label. */
const PILL_FONT_SIZE = "13px"

/** The card's ink, its quieter voice, and the wash a hovered row takes. */
export const RAIL_INK = "fg"
export const RAIL_INK_MUTED = "fg.muted"
const RAIL_WASH = "bg.subtle"
/** Focus rings and text-sized actions: the app's own link/icon green. */
const RAIL_ACCENT = "app.tint"
/** How long a switch takes to travel — quick enough to feel like the click. */
const SWITCH_MS = 160

type PillTone = "green" | "red"

/**
 * The two ways a pill can be on. Green is the ordinary "this filter is
 * applied"; red is reserved for the filters that take films away rather than
 * narrowing to them, so hiding a list cannot be mistaken for selecting it.
 */
const TONES: Record<PillTone, { bg: string; fg: string; border: string }> = {
  green: {
    bg: "app.pillActiveBackground",
    fg: "app.pillActiveText",
    // An active pill's hairline disappears into its fill, or it reads as a pale
    // rim around a solid green — the same call the app's pill makes.
    border: "app.pillActiveBackground",
  },
  red: {
    bg: "app.red.primary",
    fg: "app.red.secondary",
    border: "app.red.border",
  },
}

type RailPillProps = {
  label: string
  isOn: boolean
  onToggle: () => void
  tone?: PillTone
  /** For a pill whose label alone does not say what it does. */
  title?: string
  /** A second line under the label — the city a lone cinema is in, say. */
  sublabel?: string
  /** The quieter size, for a pill that is a helper rather than a dimension. */
  size?: "sm" | "xs"
}

export const RailPill = ({
  label,
  isOn,
  onToggle,
  tone = "green",
  title,
  sublabel,
  size = "sm",
}: RailPillProps) => {
  const active = TONES[tone]

  return (
    <RailButton
      type="button"
      onClick={onToggle}
      aria-pressed={isOn}
      title={title}
      display="inline-flex"
      flexDirection="column"
      alignItems="flex-start"
      px={size === "xs" ? "9px" : "12px"}
      py={size === "xs" ? "3px" : "6px"}
      // Round even with a second line under the label: these are selections,
      // and the shape rule does not bend for a taller one.
      borderRadius="full"
      borderWidth="1px"
      fontSize={size === "xs" ? "12px" : PILL_FONT_SIZE}
      fontWeight="500"
      lineHeight="1.3"
      whiteSpace="nowrap"
      cursor="pointer"
      transition="background-color 120ms ease, border-color 120ms ease, color 120ms ease"
      bg={isOn ? active.bg : "app.pillBackground"}
      borderColor={isOn ? active.border : "app.pillBorder"}
      color={isOn ? active.fg : "app.pillText"}
      _hover={{ borderColor: isOn ? active.border : "app.checkboxBorder" }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: RAIL_ACCENT,
        outlineOffset: "1px",
      }}
    >
      {label}
      {sublabel ? (
        <Box as="span" fontSize="10px" opacity={0.75} fontWeight="500">
          {sublabel}
        </Box>
      ) : null}
    </RailButton>
  )
}

/** The row a set of pills sits in. Gaps match the app's 7pt pill margins. */
export const RailPillRow = ({ children }: { children: ReactNode }) => (
  <Flex wrap="wrap" gap="7px">
    {children}
  </Flex>
)

/**
 * A choice between two or three ways of reading the same feed, in one track —
 * the app's `SegmentedControl`, and used for the same two things: group-by-film
 * and which of your friends' marks to narrow to.
 *
 * A segmented control rather than a row of pills, because one of these options
 * is always on and the set is exclusive. It also solves what a pill cannot:
 * "Any" is the *unfiltered* default, so its thumb is neutral rather than
 * accented — position says which is selected, colour is reserved for saying a
 * filter is actually doing something. A row of pills has no position to spend.
 */
const SEGMENT_TONES: Record<
  "green" | "orange" | "neutral",
  { bg: string; fg: string }
> = {
  green: { bg: "app.pillActiveBackground", fg: "app.pillActiveText" },
  orange: { bg: "app.orange.primary", fg: "app.orange.secondary" },
  // `app.cardBackground`, not `bg.panel`: in dark mode `surfaceMuted` (the
  // track) and `pillBackground` are the same grey, so a thumb in either
  // vanishes into the groove it slides along.
  neutral: { bg: "app.cardBackground", fg: RAIL_INK },
}

export type RailSegmentedOption<T> = {
  value: T
  label: string
  /** Defaults to green — the tone for "this is narrowing the feed". */
  tone?: keyof typeof SEGMENT_TONES
}

export const RailSegmented = <T extends string | boolean>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly RailSegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Prefix for each segment's accessible name, since the labels are terse. */
  label: string
}) => (
  <Flex
    display="inline-flex"
    align="center"
    p="2px"
    borderRadius="full"
    bg="app.surfaceMuted"
    maxW="100%"
  >
    {options.map((option) => {
      const isOn = option.value === value
      const tone = SEGMENT_TONES[option.tone ?? "green"]

      return (
        <RailButton
          type="button"
          key={String(option.value)}
          onClick={() => onChange(option.value)}
          aria-pressed={isOn}
          aria-label={`${label}: ${option.label}`}
          px="14px"
          py="5px"
          borderRadius="full"
          fontSize={PILL_FONT_SIZE}
          // One weight for both states: a weight flip reflows the label, and it
          // lands with the feed's re-render rather than the click.
          fontWeight="600"
          lineHeight="1.3"
          whiteSpace="nowrap"
          cursor="pointer"
          transition="background-color 120ms ease, color 120ms ease"
          bg={isOn ? tone.bg : "transparent"}
          color={isOn ? tone.fg : "app.pillText"}
          _hover={isOn ? undefined : { color: RAIL_INK }}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: RAIL_ACCENT,
            outlineOffset: "1px",
          }}
        >
          {option.label}
        </RailButton>
      )
    })}
  </Flex>
)

/**
 * A named thing that can be narrowed *to* or taken *away* — a Letterboxd list,
 * the watchlist, the films you have already seen.
 *
 * Three states, not two, and the app's own three: off, "only", "hide". One row
 * rather than two independent toggles because they are exclusive — a list
 * cannot both be the only thing shown and be hidden — so picking either side
 * clears the other rather than producing a filter that matches nothing.
 */
export const RailModeRow = ({
  name,
  isOnly,
  isHidden,
  onOnly,
  onHide,
}: {
  name: string
  isOnly: boolean
  isHidden: boolean
  onOnly: () => void
  onHide: () => void
}) => (
  <Flex align="center" justify="space-between" gap={2} minW={0}>
    <Text fontSize="13px" color={RAIL_INK} truncate title={name}>
      {name}
    </Text>
    <Flex gap="6px" flexShrink={0}>
      <RailPill
        label="Only"
        size="xs"
        title={`Show only ${name}`}
        isOn={isOnly}
        onToggle={onOnly}
      />
      <RailPill
        label="Hide"
        size="xs"
        tone="red"
        title={`Hide ${name}`}
        isOn={isHidden}
        onToggle={onHide}
      />
    </Flex>
  </Flex>
)

/**
 * A button that *does* something on the card — applies a preset, saves one,
 * clears a selection — as opposed to a pill, which holds state. Squared, at the
 * radius the app sizes its preset buttons from; the corner is the whole signal.
 *
 * `meta` is a second line under the label, for the thing a row is rather than
 * the thing it does: a cinema preset's "7 cinemas". `icon` leads the label —
 * the app marks the account's own cinemas with a star here and nothing else.
 *
 * `isCurrent` says the state this button would apply is the state already in
 * force, which the app's preset rows show. It is an *outline*, never a fill:
 * these sit inches from the cinema chips, which are filled when selected, and a
 * filled preset row read as one more chip.
 */
export const RailActionButton = ({
  children,
  onClick,
  fullWidth = false,
  title,
  meta,
  icon,
  isCurrent = false,
  tone = "default",
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  fullWidth?: boolean
  title?: string
  meta?: ReactNode
  icon?: ReactNode
  isCurrent?: boolean
  /** "accent" for the one action on a card worth reaching for first. */
  tone?: "default" | "accent"
  disabled?: boolean
}) => (
  <RailButton
    type="button"
    onClick={onClick}
    title={title}
    disabled={disabled}
    w={fullWidth ? "100%" : undefined}
    minW={0}
    px="12px"
    py="7px"
    borderRadius={`${PRESET_BUTTON_RADIUS}px`}
    borderWidth="1px"
    borderColor={
      isCurrent ? "app.tint" : tone === "accent" ? "app.green.border" : "border"
    }
    bg={tone === "accent" ? "app.green.primary" : "bg.panel"}
    color={tone === "accent" ? "app.green.secondary" : RAIL_INK}
    fontSize="13px"
    fontWeight="600"
    lineHeight="1.3"
    textAlign="left"
    cursor={disabled ? "default" : "pointer"}
    opacity={disabled ? 0.55 : 1}
    transition="background-color 120ms ease, border-color 120ms ease"
    _hover={
      disabled
        ? undefined
        : {
            bg: tone === "accent" ? "app.green.primary" : RAIL_WASH,
            borderColor: "app.checkboxBorder",
          }
    }
    _focusVisible={{
      outline: "2px solid",
      outlineColor: RAIL_ACCENT,
      outlineOffset: "1px",
    }}
  >
    <Flex align="center" gap="6px" minW={0}>
      {icon ? (
        <Box flexShrink={0} display="flex">
          {icon}
        </Box>
      ) : null}
      <Box minW={0} flex="1">
        <Box truncate>{children}</Box>
        {meta ? (
          <Box
            fontSize="11px"
            fontWeight="500"
            color={tone === "accent" ? "app.green.secondary" : RAIL_INK_MUTED}
            truncate
          >
            {meta}
          </Box>
        ) : null}
      </Box>
    </Flex>
  </RailButton>
)

/**
 * A text-sized action inside a section — "Select all", "Clear", "Add". Carries
 * no box of its own: a full button every few rows would out-shout the controls
 * it sits beside, and every one of these is undone in one click.
 */
export const RailTextButton = ({
  children,
  onClick,
  title,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  /** Kept on screen rather than removed: these say what they would do, and a
      label that vanishes the moment it becomes true answers nothing. */
  disabled?: boolean
}) => (
  <RailButton
    type="button"
    onClick={onClick}
    title={title}
    disabled={disabled}
    px="2px"
    bg="transparent"
    color={disabled ? RAIL_INK_MUTED : RAIL_ACCENT}
    fontSize="12px"
    fontWeight="600"
    lineHeight="1.3"
    whiteSpace="nowrap"
    cursor={disabled ? "default" : "pointer"}
    textDecoration={disabled ? "none" : "underline"}
    textUnderlineOffset="2px"
    textDecorationColor="border"
    _hover={disabled ? undefined : { textDecorationColor: "currentColor" }}
    _focusVisible={{
      outline: "2px solid",
      outlineColor: RAIL_ACCENT,
      outlineOffset: "2px",
    }}
  >
    {children}
  </RailButton>
)

/** The small square actions that sit beside a named row — favourite, rename, delete. */
export const RailIconButton = ({
  label,
  onClick,
  title,
  children,
}: {
  /** The accessible name; these carry an icon and no text. */
  label: string
  onClick: () => void
  title?: string
  children: ReactNode
}) => (
  <RailButton
    type="button"
    aria-label={label}
    title={title ?? label}
    onClick={onClick}
    flexShrink={0}
    display="flex"
    alignItems="center"
    justifyContent="center"
    boxSize="28px"
    borderRadius={`${PRESET_BUTTON_RADIUS}px`}
    bg="transparent"
    color={RAIL_INK}
    cursor="pointer"
    transition="background-color 120ms ease"
    _hover={{ bg: RAIL_WASH }}
    _focusVisible={{
      outline: "2px solid",
      outlineColor: RAIL_ACCENT,
      outlineOffset: "1px",
    }}
  >
    {children}
  </RailButton>
)

/**
 * A switch as a sentence: the whole row is the control, because these are the
 * features the product is *for* and a toggle you have to aim for is one you
 * are not being offered.
 *
 * The row itself never fills — only the track does, solid `app.tint` with a
 * white thumb sliding to the right, the same two states the app's own
 * `AppSwitch` draws (`trackColor: { false: divider, true: tint }`, white
 * thumb). A first version filled the whole row when on; beside a neutral row
 * for every other setting it read louder than a switch should, and the app's
 * own switches never do it either.
 */
export const RailSwitchRow = ({
  label,
  isOn,
  onToggle,
  disabled = false,
}: {
  label: string
  isOn: boolean
  onToggle: () => void
  /** Greyed and inert — for a switch that needs something set up first. */
  disabled?: boolean
}) => (
  <RailButton
    type="button"
    onClick={onToggle}
    disabled={disabled}
    role="switch"
    aria-checked={isOn}
    opacity={disabled ? 0.45 : 1}
    w="100%"
    display="flex"
    alignItems="center"
    gap="9px"
    px="8px"
    py="6px"
    mb="1px"
    borderRadius="6px"
    bg="transparent"
    color={RAIL_INK}
    cursor={disabled ? "not-allowed" : "pointer"}
    textAlign="left"
    _hover={disabled ? undefined : { bg: RAIL_WASH }}
  >
    {/* The thumb slides rather than jumping ends, and on the click itself —
        the value it reads is the rail's optimistic copy, so nothing it waits
        for is slower than a frame. */}
    <Box
      position="relative"
      w="28px"
      h="17px"
      flexShrink={0}
      borderRadius="full"
      borderWidth="1px"
      borderColor={isOn ? RAIL_ACCENT : "border"}
      bg={isOn ? RAIL_ACCENT : "bg.subtle"}
      transition={`background-color ${SWITCH_MS}ms ease, border-color ${SWITCH_MS}ms ease`}
    >
      <Box
        position="absolute"
        top="2px"
        left="2px"
        boxSize="11px"
        borderRadius="full"
        bg={isOn ? "white" : RAIL_INK_MUTED}
        transform={isOn ? "translateX(11px)" : "translateX(0)"}
        transition={`transform ${SWITCH_MS}ms cubic-bezier(0.3, 0.7, 0.4, 1), background-color ${SWITCH_MS}ms ease`}
      />
    </Box>
    {/* Nudged: a label with no descenders leaves its own line-box empty
        below the letters, so centering it against the switch's box lands
        the ink high. */}
    <Box
      fontSize="13px"
      fontWeight="600"
      minW={0}
      flex="1"
      position="relative"
      top="1px"
    >
      {label}
    </Box>
  </RailButton>
)

/** The small uppercase label a non-collapsible rail part starts with — the
 * same spec `RailSection`'s own heading uses, for a block with no accordion. */
export const RailPartLabel = ({ children }: { children: ReactNode }) => (
  <Text
    fontSize="11px"
    fontWeight="700"
    textTransform="uppercase"
    letterSpacing="0.6px"
    color={RAIL_INK}
    mb="7px"
  >
    {children}
  </Text>
)

/**
 * The heading a single dimension gets *inside* a `RailSection` — "Days",
 * "Time of day", "Marked by friends" — one size down from the section's own
 * uppercase title (muted rather than full ink, so the section title still
 * reads first), with the dimension's own "Clear" riding on the same line when
 * it has something to clear. A dimension folded into a shared section with no
 * heading of its own has no way to say, collapsed, which of the section's
 * several controls is holding a filter — the section's own summary already
 * lists them, but the open state needs the same anchor the summary gives it.
 */
export const RailFacetHeading = ({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) => (
  <Flex align="center" justify="space-between" gap={2} mb="6px" minH="16px">
    <Text
      fontSize="11px"
      fontWeight="700"
      color={RAIL_INK_MUTED}
      textTransform="uppercase"
      letterSpacing="0.6px"
      truncate
    >
      {children}
    </Text>
    {action}
  </Flex>
)

/**
 * A block of the rail that is always open — cinemas, quick filters, the
 * switches — as opposed to `RailSection`, which folds away. Carries the same
 * tear at its top as every other block, so the rail still reads as one strip
 * of stubs regardless of which parts can collapse.
 */
export const RailPart = ({ children }: { children: ReactNode }) => (
  <Box>
    <div className="mk-rail__tear" aria-hidden />
    <Box px={3} pb="10px">
      {children}
    </Box>
  </Box>
)

/**
 * A native `date` / `time` / `number` box, dressed for the card.
 *
 * Native rather than a picker built here: the browser's own is keyboard
 * navigable, localised, and already familiar, and the app's equivalent (a
 * calendar sheet, a dual-handle slider) is answering a touch screen's problem
 * rather than a mouse's. `color-scheme` is set on the rail in CSS, which is
 * what makes the dropdown these open follow dark mode.
 */
export const RailInput = ({
  value,
  onChange,
  type,
  label,
  min,
  max,
  step,
}: {
  value: string
  onChange: (value: string) => void
  type: "date" | "time" | "number"
  /** The accessible name; these sit under a heading rather than a label. */
  label: string
  min?: string | number
  max?: string | number
  step?: number
}) => (
  <RailTextInput
    type={type}
    value={value}
    aria-label={label}
    min={min}
    max={max}
    step={step}
    onChange={(event: ChangeEvent<HTMLInputElement>) =>
      onChange(event.target.value)
    }
    flex="1"
    minW={0}
    px="8px"
    py="5px"
    borderRadius={`${PRESET_BUTTON_RADIUS}px`}
    borderWidth="1px"
    borderColor="border"
    bg="bg.panel"
    color={RAIL_INK}
    fontSize="13px"
    lineHeight="1.3"
    _focusVisible={{
      outline: "2px solid",
      outlineColor: RAIL_ACCENT,
      outlineOffset: "1px",
    }}
  />
)

/**
 * A heading for a block *inside* a section — one step down from the section's
 * own uppercase label, exactly as `FilterSubLabel` is in the app.
 */
export const RailSubLabel = ({
  label,
  action,
}: {
  label: string
  /** An action belonging to this block alone — a city's "All", say. */
  action?: ReactNode
}) => (
  <Flex align="center" justify="space-between" gap={2} mb="6px">
    <Text fontSize="13px" fontWeight="600" color={RAIL_INK} truncate>
      {label}
    </Text>
    {action}
  </Flex>
)

/** A line of explanation under a control. Never carries a control of its own. */
export const RailNote = ({ children }: { children: ReactNode }) => (
  <Text fontSize="12px" color={RAIL_INK_MUTED} lineHeight="1.4">
    {children}
  </Text>
)

/** One filter that is on, as a chip that takes it off. */
export type RailChipItem = {
  key: string
  label: string
  /** An excluding filter: the ⊘ stands in for the word "Hide", as in the app. */
  excludes?: boolean
  /** The chip in full, for a label that summarises ("Fri 5 Sep +3"). */
  title?: string
  onRemove: () => void
}

/**
 * The app's active-filter chip (`mobile/components/filters/ActiveFilterChip`):
 * the filter's value, an × after it, and the whole chip is the button that
 * takes the filter off. One chip per filter, not per value — see
 * `summarizeChipValues`.
 *
 * Coloured and a size up from the app's neutral chip, on purpose: these sit in
 * a *folded* section, and the one job they have is that nobody searches with a
 * filter on without noticing. The soft fill and hairline are the rail's own
 * "this is on" family — the same green as an active pill or "Clear filters",
 * the same red as a hidden list — so they stand out without shouting.
 */
const RailChip = ({
  label,
  excludes = false,
  title,
  onRemove,
}: Omit<RailChipItem, "key">) => {
  const palette = excludes ? "red" : "green"
  return (
    <RailButton
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter: ${title ?? (excludes ? `Hide ${label}` : label)}`}
      title={title ?? label}
      display="inline-flex"
      alignItems="center"
      gap="5px"
      maxW="100%"
      minW={0}
      pl="11px"
      pr="8px"
      py="5px"
      borderRadius="full"
      borderWidth="1px"
      borderColor={`app.${palette}.border`}
      bg={`app.${palette}.primary`}
      color={`app.${palette}.secondary`}
      fontSize="13px"
      fontWeight="600"
      lineHeight="1.3"
      cursor="pointer"
      animation="rail-chip-in 160ms ease-out"
      transition="filter 120ms ease"
      _hover={{ filter: "brightness(0.96)" }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: RAIL_ACCENT,
        outlineOffset: "1px",
      }}
    >
      {excludes ? (
        <Box as={MdBlock} boxSize="13px" flexShrink={0} aria-hidden />
      ) : null}
      <Box as="span" truncate position="relative" top="1px">
        {label}
      </Box>
      <Box
        as={MdClose}
        boxSize="14px"
        flexShrink={0}
        opacity={0.8}
        aria-hidden
      />
    </RailButton>
  )
}

/**
 * The app's rule for a filter holding several values: name the first, count
 * the rest — "Fri 5 Sep +3" — so one filter stays one chip.
 */
export const summarizeChipValues = (labels: readonly string[]): string =>
  labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : (labels[0] ?? "")

type RailSectionProps = {
  title: string
  /**
   * What the section would filter on, shown in the header while closed and
   * nothing in it is on — "Any day, any time".
   */
  summary?: string
  /**
   * Every filter in the section that is on. While the section is closed they
   * sit under its heading as chips, as the app's active-filter row does: a
   * folded section is exactly where a filter can be on without anyone noticing.
   * Open, the controls themselves say it, so the chips step aside.
   */
  chips?: readonly RailChipItem[]
  /**
   * Open on mount. True for the dimensions worth the vertical space — the point
   * of a rail over the app's sheet is that they are already open — and false
   * for the long ones, which would otherwise push the card past the viewport
   * and cost it the pinning that makes it worth having.
   */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * One heading and its controls, torn from its neighbour along a perforation
 * (`FeedFilterRail.css`) rather than divided by a hairline.
 *
 * Every section carries its own tear at the top — including the first, which
 * tears off the rail's heading — so there is no first-child case to get wrong
 * and the rail reads as a strip of stubs however many sections a given page
 * shows. Full-bleed tears are also why the rail owns its own padding rather
 * than taking it from the panel around it: a perforation stopping short of the
 * edges is a dashed line, not a tear.
 */
export const RailSection = ({
  title,
  summary,
  chips = [],
  defaultOpen = true,
  children,
}: RailSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const showsChips = !isOpen && chips.length > 0

  return (
    <Box>
      <div className="mk-rail__tear" aria-hidden />
      <RailButton
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        w="100%"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
        px={3}
        py="8px"
        bg="transparent"
        cursor="pointer"
        textAlign="left"
        _hover={{ bg: RAIL_WASH }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: RAIL_ACCENT,
          outlineOffset: "-2px",
        }}
      >
        <Text
          fontSize="11px"
          fontWeight="700"
          textTransform="uppercase"
          letterSpacing="0.6px"
          color={RAIL_INK}
          flexShrink={0}
        >
          {title}
        </Text>
        <Flex align="center" gap="6px" minW={0}>
          {!isOpen && !showsChips && summary ? (
            <Text
              fontSize="12px"
              fontWeight="600"
              color={RAIL_INK_MUTED}
              truncate
              position="relative"
              top="1px"
            >
              {summary}
            </Text>
          ) : null}
          <Box
            as={FiChevronDown}
            color={RAIL_INK_MUTED}
            flexShrink={0}
            transition="transform 160ms ease"
            transform={isOpen ? "rotate(180deg)" : "rotate(0deg)"}
          />
        </Flex>
      </RailButton>

      {showsChips ? (
        <Flex wrap="wrap" gap="6px" px={3} pb="10px">
          {chips.map(({ key, ...chip }) => (
            <RailChip key={key} {...chip} />
          ))}
        </Flex>
      ) : null}

      {isOpen ? (
        <Box px={3} pb="10px">
          {children}
        </Box>
      ) : null}
    </Box>
  )
}
