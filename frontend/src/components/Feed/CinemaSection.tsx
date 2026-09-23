/**
 * The cinemas part of the rail: what you are looking at, your saved sets, and
 * the way into the full cinema sheet.
 *
 * Your preferred cinemas are not a separate option; they are one of your sets,
 * under the name you gave them, and among the sets they carry a small star in
 * the set's own ink — the app's star for "preferred", without a colour of its
 * own. The summary needs no star: the line under it says so in words.
 *
 * That line is either an offer or a fact: "Save current selection as preferred
 * cinemas", or "These are your preferred cinemas". There is no "just for now"
 * and no "back to" — the sets are right there for going back, one click each.
 *
 * The sets only appear once there is a choice to make: two or more saved (your
 * preferred cinemas count as one). With a single set there is nothing to switch
 * between, and a row of one chip is chrome.
 */
import { Box, Flex, Text, chakra } from "@chakra-ui/react"
import type { Ref } from "react"
import { MdCheck, MdChevronRight, MdStar, MdStarBorder } from "react-icons/md"
import type { CinemaPublic } from "shared/client"
import { serializeCinemaIds } from "shared/filters/cinema-grouping"
import { formatCinemaCount } from "shared/filters/cinema-selection"

import { RailPartLabel } from "@/components/Feed/FilterRailControls"
import type { CinemaPresetState } from "@/features/showtimes/use-cinema-preset-state"

const Pressable = chakra("button")

/** How the saved sets are drawn in the rail. */
export type SetsStyle = "chips" | "list"

/** The two sets it takes before there is anything to switch between. */
const MIN_SETS_TO_SHOW = 2

/** What the preferred set is called when the account has not named it. */
const PREFERRED_FALLBACK_NAME = "Preferred cinemas"

type Described = {
  label: string
  meta: string
  /** The count line is redundant with the label (label *is* the count) — kept
   * in layout so the rail's height never shifts, just not shown twice. */
  hideMeta?: boolean
  isPreferred: boolean
}

/**
 * Name the selection by what it *is*: your preferred set or another set by its
 * name, a venue or two by name, and only then a count. The count goes under the
 * name rather than after it, so a long name gets the whole line.
 */
const describe = (
  ids: number[],
  cinemas: CinemaPublic[],
  presetState: CinemaPresetState,
): Described => {
  const count = formatCinemaCount(ids.length)
  if (presetState.isPreferred(ids)) {
    return {
      label: presetState.preferred?.name ?? PREFERRED_FALLBACK_NAME,
      meta: count,
      isPreferred: true,
    }
  }
  const preset = presetState.namedPresetFor(ids)
  if (preset) return { label: preset.name, meta: count, isPreferred: false }
  if (ids.length === cinemas.length)
    return { label: "All cinemas", meta: count, isPreferred: false }
  if (ids.length <= 2) {
    const names = ids.map(
      (id) => cinemas.find((cinema) => cinema.id === id)?.name ?? "?",
    )
    return { label: names.join(" & "), meta: count, isPreferred: false }
  }
  // The count *is* the name here — showing it again below would be redundant,
  // but the line still needs to hold its space (see `hideMeta` above).
  return { label: count, meta: count, hideMeta: true, isPreferred: false }
}

type SetEntry = {
  id: string
  name: string
  cinemaIds: number[]
  isPreferred: boolean
}

/** Not a saved preset — always there, always last, so there is always a way back to everything. */
const ALL_CINEMAS_SET_ID = "__all-cinemas__"

/** The preferred set's mark: the app's star, in whatever ink the set is drawn in. */
const PreferredMark = ({ size }: { size: number }) => (
  <Box
    display="flex"
    flexShrink={0}
    opacity={0.75}
    role="img"
    aria-label="Preferred cinemas"
  >
    <MdStar size={size} />
  </Box>
)

const SetChips = ({
  sets,
  currentSignature,
  onChoose,
}: {
  sets: SetEntry[]
  currentSignature: string
  onChoose: (ids: number[]) => void
}) => (
  <Flex wrap="wrap" gap="6px">
    {sets.map(({ id, name, cinemaIds, isPreferred }) => {
      const isOn = serializeCinemaIds(cinemaIds) === currentSignature
      return (
        <Pressable
          key={id}
          type="button"
          onClick={() => onChoose(cinemaIds)}
          aria-pressed={isOn}
          title={`${isPreferred ? "Your preferred cinemas · " : ""}${formatCinemaCount(cinemaIds.length)}`}
          display="inline-flex"
          alignItems="center"
          gap="5px"
          maxW="100%"
          px="11px"
          py="5px"
          // Fully round: a set is a state you are in, and it lights when you are.
          borderRadius="full"
          borderWidth="1px"
          borderColor={isOn ? "app.pillActiveBackground" : "app.pillBorder"}
          bg={isOn ? "app.pillActiveBackground" : "app.pillBackground"}
          color={isOn ? "app.pillActiveText" : "app.pillText"}
          fontSize="12px"
          fontWeight="600"
          cursor="pointer"
          _hover={{ borderColor: "app.tint" }}
        >
          {isPreferred ? <PreferredMark size={13} /> : null}
          {/* A slight downward nudge: text with no descenders (most cinema
              names) leaves its own line-box empty below the letters, so
              centering it against the star's box lands the ink high. */}
          <Box as="span" truncate position="relative" top="1px">
            {name}
          </Box>
        </Pressable>
      )
    })}
  </Flex>
)

const SetList = ({
  sets,
  currentSignature,
  onChoose,
}: {
  sets: SetEntry[]
  currentSignature: string
  onChoose: (ids: number[]) => void
}) => (
  <Flex direction="column" gap="2px">
    {sets.map(({ id, name, cinemaIds, isPreferred }) => {
      const isOn = serializeCinemaIds(cinemaIds) === currentSignature
      return (
        <Pressable
          key={id}
          type="button"
          onClick={() => onChoose(cinemaIds)}
          aria-pressed={isOn}
          display="flex"
          alignItems="center"
          gap="8px"
          w="100%"
          px="8px"
          py="6px"
          borderRadius="8px"
          bg={isOn ? "app.green.primary" : "transparent"}
          color={isOn ? "app.green.secondary" : "fg"}
          textAlign="left"
          cursor="pointer"
          _hover={{ bg: isOn ? "app.green.primary" : "bg.subtle" }}
        >
          <Box w="16px" display="flex" flexShrink={0}>
            {isPreferred ? <PreferredMark size={15} /> : null}
          </Box>
          <Box flex="1" minW={0}>
            <Text
              fontSize="13px"
              fontWeight={isOn ? "700" : "600"}
              lineClamp={2}
            >
              {name}
            </Text>
            <Text fontSize="11px" color={isOn ? "currentColor" : "fg.muted"}>
              {formatCinemaCount(cinemaIds.length)}
            </Text>
          </Box>
          <Box w="16px" display="flex" flexShrink={0}>
            {isOn ? <MdCheck size={15} /> : null}
          </Box>
        </Pressable>
      )
    })}
  </Flex>
)

export const CinemaSection = ({
  cinemas,
  shownIds,
  isOpen,
  onToggleOpen,
  onChoose,
  presetState,
  onSavePreferred,
  setsStyle = "chips",
  triggerRef,
}: {
  cinemas: CinemaPublic[]
  /** The sheet's draft while it is open, the feed's selection otherwise. */
  shownIds: number[]
  isOpen: boolean
  onToggleOpen: () => void
  /** A set was clicked. */
  onChoose: (ids: number[]) => void
  presetState: CinemaPresetState
  /** Save what is shown as the preferred cinemas; asks a guest to sign in. */
  onSavePreferred: () => void
  setsStyle?: SetsStyle
  triggerRef: Ref<HTMLButtonElement>
}) => {
  const described = describe(shownIds, cinemas, presetState)
  const currentSignature = serializeCinemaIds(shownIds)
  const allCinemaIds = cinemas.map((cinema) => cinema.id)
  const sets: SetEntry[] = [
    ...(presetState.preferred
      ? [
          {
            id: presetState.preferred.id,
            name: presetState.preferred.name,
            cinemaIds: presetState.preferred.cinema_ids,
            isPreferred: true,
          },
        ]
      : []),
    ...presetState.named.map((preset) => ({
      id: preset.id,
      name: preset.name,
      cinemaIds: preset.cinema_ids,
      isPreferred: false,
    })),
    // Always last, always there: whatever else changes, there is one click
    // back to no filtering by cinema at all.
    ...(allCinemaIds.length > 0
      ? [
          {
            id: ALL_CINEMAS_SET_ID,
            name: "All cinemas",
            cinemaIds: allCinemaIds,
            isPreferred: false,
          },
        ]
      : []),
  ]
  const showsSets = sets.length >= MIN_SETS_TO_SHOW

  return (
    <Box px="12px" pt="10px" pb="10px">
      <RailPartLabel>Cinemas</RailPartLabel>
      <Flex align="center" gap="10px">
        {/* Fixed height, so switching between a named set and a plain count
            never jumps the rail. A plain count used to sit in this same box
            as the small 14px label, with the meta line hidden but still
            reserving its space below — small text over a gap that had
            nothing in it. Now it fills the same space on purpose, as one
            larger line, rather than leaving that gap unexplained. */}
        <Box
          flex="1"
          minW={0}
          minH="35px"
          display="flex"
          flexDirection="column"
          justifyContent="center"
        >
          {described.hideMeta ? (
            <Text fontSize="20px" fontWeight="800" color="fg" lineHeight="1.15">
              {described.label}
            </Text>
          ) : (
            <>
              {/* Wraps rather than truncating: the name is the one thing here
                  you read, and "Amsterdam arthouse…" does not say which set
                  it is. */}
              <Text
                fontSize="14px"
                fontWeight="700"
                color="fg"
                lineHeight="1.3"
                lineClamp={2}
              >
                {described.label}
              </Text>
              <Text fontSize="12px" color="fg.muted" lineHeight="1.3" mt="1px">
                {described.meta}
              </Text>
            </>
          )}
        </Box>
        <Pressable
          ref={triggerRef}
          type="button"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          display="inline-flex"
          alignItems="center"
          gap="2px"
          flexShrink={0}
          pl="10px"
          pr="6px"
          py="5px"
          // Squared: this does a thing — it opens the sheet — rather than
          // holding a value. Lit while the sheet it opened is out.
          borderRadius="8px"
          borderWidth="1px"
          borderColor={isOpen ? "app.green.border" : "app.pillBorder"}
          bg={isOpen ? "app.green.primary" : "app.pillBackground"}
          color={isOpen ? "app.green.secondary" : "fg"}
          fontSize="12px"
          fontWeight="700"
          cursor="pointer"
          _hover={{ borderColor: "app.tint" }}
        >
          <Box as="span" position="relative" top="1px">
            Select cinemas
          </Box>
          {/* Points where the sheet opens. */}
          <MdChevronRight size={16} />
        </Pressable>
      </Flex>

      {showsSets ? (
        <Box mt="10px">
          {setsStyle === "chips" ? (
            <SetChips
              sets={sets}
              currentSignature={currentSignature}
              onChoose={onChoose}
            />
          ) : (
            <SetList
              sets={sets}
              currentSignature={currentSignature}
              onChoose={onChoose}
            />
          )}
        </Box>
      ) : null}

      <Box mt="8px">
        {described.isPreferred ? (
          <Flex
            align="center"
            gap="5px"
            color="fg.muted"
            fontSize="12px"
            fontWeight="600"
            py="2px"
            px="6px"
          >
            <MdCheck size={14} />
            {/* Nudged: text with no descenders leaves its own line-box empty
                below the letters, so centering it against the icon's box
                lands the ink high. */}
            <Box as="span" position="relative" top="1px">
              These are your preferred cinemas
            </Box>
          </Flex>
        ) : (
          // Same shape as "Save current filters": a quiet tinted chip, not
          // underlined body text, so the two "save this as a default" actions
          // in the rail read as the same kind of thing.
          <Pressable
            type="button"
            onClick={onSavePreferred}
            display="inline-flex"
            alignItems="center"
            gap="4px"
            px="6px"
            py="2px"
            borderRadius="6px"
            bg="transparent"
            color="app.tint"
            fontSize="12px"
            fontWeight="700"
            textAlign="left"
            cursor="pointer"
            _hover={{ bg: "bg.subtle" }}
          >
            <MdStarBorder size={15} />
            <Box as="span" position="relative" top="1px">
              Save current selection as preferred cinemas
            </Box>
          </Pressable>
        )}
      </Box>
    </Box>
  )
}
