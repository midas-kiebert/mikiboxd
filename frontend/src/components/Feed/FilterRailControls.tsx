/**
 * The vocabulary the filter rail is built from: a section, a pill, a
 * sub-heading.
 *
 * Every one of these is the app's control rendered for a mouse. The metrics
 * are lifted from `mobile/components/filters` — the section heading's 11px
 * uppercase with its 0.6 tracking, the pill's 13px/500 on a fully rounded
 * hairline — so the two clients read as the same product rather than as a site
 * and an app that happen to filter the same things. The colours come from the
 * palette both share, so neither can drift on a green.
 *
 * What is different is the ground. These sit on the rail's tinted green card
 * rather than on the page, so the neutrals that work everywhere else do not
 * work here: `fg.muted` is too close to the tint to read, and `bg.subtle` is a
 * grey patch on a green panel. Ink is the tint's own `app.green.secondary`,
 * which the palette tunes to clear 4.9:1 on `app.green.primary`; a pill's rest
 * surface is `bg.panel`, the card white (or near-black) that reads as a raised
 * chip on the tint in both modes; and anything that has to be a wash of the
 * ground is that same ink at low alpha.
 *
 * A pill is *state*: fully round, per the shape rule the app follows
 * everywhere (a squared corner means an action). Nothing here is an action.
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import { type ReactNode, useState } from "react"
import { FiChevronDown } from "react-icons/fi"
import { PRESET_BUTTON_RADIUS } from "shared/filters/filter-control-metrics"

/** Matches the app's in-modal pill: 12/6 padding on a 13px label. */
const PILL_FONT_SIZE = "13px"

/** The tint's own ink, and the two washes of it the card needs. */
export const RAIL_INK = "app.green.secondary"
const RAIL_WASH = "app.green.secondary/12"
const RAIL_HAIRLINE = "app.green.secondary/20"

type PillTone = "green" | "red"

/**
 * The two ways a pill can be on. Green is the ordinary "this filter is
 * applied"; red is reserved for the one filter that takes films away rather
 * than narrowing to them, so excluding a list cannot be mistaken for
 * selecting it.
 */
const TONES: Record<PillTone, { bg: string; fg: string; border: string }> = {
  green: {
    bg: "app.pillActiveBackground",
    fg: "app.pillActiveText",
    // An active pill's hairline disappears into its fill, or it reads as a
    // pale rim around a solid green — the same call the app's pill makes.
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
}

export const RailPill = ({
  label,
  isOn,
  onToggle,
  tone = "green",
  title,
}: RailPillProps) => {
  const active = TONES[tone]

  return (
    <Box
      as="button"
      type="button"
      onClick={onToggle}
      aria-pressed={isOn}
      title={title}
      px="12px"
      py="6px"
      borderRadius="full"
      borderWidth="1px"
      fontSize={PILL_FONT_SIZE}
      fontWeight="500"
      lineHeight="1.3"
      whiteSpace="nowrap"
      cursor="pointer"
      transition="background-color 120ms ease, border-color 120ms ease, color 120ms ease"
      bg={isOn ? active.bg : "bg.panel"}
      borderColor={isOn ? active.border : "app.pillBorder"}
      color={isOn ? active.fg : "app.pillText"}
      _hover={{ borderColor: isOn ? active.border : "app.checkboxBorder" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "app.tint", outlineOffset: "1px" }}
    >
      {label}
    </Box>
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
 *
 * The thumb tones are the app's own: green for going, orange for interested,
 * the card surface for a default that filters nothing. `app.cardBackground` and
 * not `bg.panel` for that neutral thumb, because in dark mode `surfaceMuted`
 * (the track) and `pillBackground` are the same grey and the thumb would
 * vanish into the track.
 */
const SEGMENT_TONES: Record<
  "green" | "orange" | "neutral",
  { bg: string; fg: string }
> = {
  green: { bg: "app.pillActiveBackground", fg: "app.pillActiveText" },
  orange: { bg: "app.orange.primary", fg: "app.orange.secondary" },
  neutral: { bg: "app.cardBackground", fg: "fg" },
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
        <Box
          as="button"
          type="button"
          key={String(option.value)}
          onClick={() => onChange(option.value)}
          aria-pressed={isOn}
          aria-label={`${label}: ${option.label}`}
          px="14px"
          py="5px"
          borderRadius="full"
          fontSize={PILL_FONT_SIZE}
          fontWeight={isOn ? "600" : "500"}
          lineHeight="1.3"
          whiteSpace="nowrap"
          cursor="pointer"
          transition="background-color 120ms ease, color 120ms ease"
          bg={isOn ? tone.bg : "transparent"}
          color={isOn ? tone.fg : "app.pillText"}
          _hover={isOn ? undefined : { color: RAIL_INK }}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: RAIL_INK,
            outlineOffset: "1px",
          }}
        >
          {option.label}
        </Box>
      )
    })}
  </Flex>
)

/**
 * A button that *does* something on the card — applies a preset, saves one,
 * clears a selection — as opposed to a pill, which holds state.
 *
 * Squared, at the radius the app sizes its preset buttons from, and that is
 * the whole point: every stateful control in the filter UI is fully rounded,
 * so the corner is what says this one is not a selection. A preset's label is
 * the user's own name for it and can never carry that signal itself. The
 * radius comes from `shared/filters` rather than a number here, so the two
 * clients cannot drift on it.
 *
 * It follows that an action must never render in a selected style, even when
 * the filters happen to match the preset exactly — highlighting the matching
 * one is the obvious "improvement" that would put these straight back into the
 * selection family.
 */
export const RailActionButton = ({
  children,
  onClick,
  fullWidth = false,
  title,
}: {
  children: ReactNode
  onClick: () => void
  fullWidth?: boolean
  title?: string
}) => (
  <Box
    as="button"
    type="button"
    onClick={onClick}
    title={title}
    w={fullWidth ? "100%" : undefined}
    minW={0}
    px="12px"
    py="7px"
    borderRadius={`${PRESET_BUTTON_RADIUS}px`}
    borderWidth="1px"
    borderColor="app.green.border"
    bg="bg.panel"
    color={RAIL_INK}
    fontSize="13px"
    fontWeight="600"
    lineHeight="1.3"
    textAlign="left"
    cursor="pointer"
    truncate
    transition="background-color 120ms ease, border-color 120ms ease"
    _hover={{ bg: RAIL_WASH }}
    _focusVisible={{
      outline: "2px solid",
      outlineColor: RAIL_INK,
      outlineOffset: "1px",
    }}
  >
    {children}
  </Box>
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
  <Box
    as="button"
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
    color={RAIL_INK}
    cursor="pointer"
    transition="background-color 120ms ease"
    _hover={{ bg: RAIL_WASH }}
    _focusVisible={{
      outline: "2px solid",
      outlineColor: RAIL_INK,
      outlineOffset: "1px",
    }}
  >
    {children}
  </Box>
)

/**
 * A heading for a block *inside* a section — one step down from the section's
 * own uppercase label, exactly as `FilterSubLabel` is in the app.
 */
export const RailSubLabel = ({ label }: { label: string }) => (
  <Text fontSize="13px" fontWeight="600" color={RAIL_INK} mb="6px">
    {label}
  </Text>
)

type RailSectionProps = {
  title: string
  /**
   * What the section is currently filtering on, shown in the header while
   * closed so a collapsed section still says what it is doing.
   */
  summary?: string
  /**
   * Open on mount. True for the dimensions worth the vertical space — the
   * point of a rail over the app's sheet is that they are already open — and
   * false for the two long ones, which would otherwise push the card past the
   * viewport and cost it the pinning that makes it worth having.
   */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * One heading and its controls, divided from its neighbour by a hairline that
 * runs the full width of the card. Full-bleed dividers are why the rail owns
 * its own padding rather than taking it from the panel around it.
 */
export const RailSection = ({
  title,
  summary,
  defaultOpen = true,
  children,
}: RailSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <Box borderTopWidth="1px" borderColor={RAIL_HAIRLINE} _first={{ borderTopWidth: 0 }}>
      <Box
        as="button"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        w="100%"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
        px={3}
        py="10px"
        cursor="pointer"
        textAlign="left"
        _hover={{ bg: RAIL_WASH }}
        _focusVisible={{ outline: "2px solid", outlineColor: RAIL_INK, outlineOffset: "-2px" }}
      >
        <Text
          fontSize="11px"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.6px"
          color={RAIL_INK}
        >
          {title}
        </Text>
        <Flex align="center" gap="6px" minW={0}>
          {!isOpen && summary ? (
            <Text fontSize="12px" fontWeight="600" color={RAIL_INK} truncate>
              {summary}
            </Text>
          ) : null}
          <Box
            as={FiChevronDown}
            color={RAIL_INK}
            flexShrink={0}
            transition="transform 160ms ease"
            transform={isOpen ? "rotate(180deg)" : "rotate(0deg)"}
          />
        </Flex>
      </Box>

      {isOpen ? (
        <Box px={3} pb={3}>
          {children}
        </Box>
      ) : null}
    </Box>
  )
}
