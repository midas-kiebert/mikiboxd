/**
 * How many tickets a row the ticket wall draws.
 *
 * Not among the filters: it changes how the feed looks, not what is in it. It
 * sits under the rail card, in the rail's column, as a card of its own
 * (`FeedLayout`'s `railFooter`); with the rail folded to its strip it is a
 * compact column of glyphs in the strip instead — which is also where a fifth
 * ticket a row is offered, in the room the folded rail gives back.
 *
 * One groove, one thumb, like `RailSegmented`, but always neutral: green is
 * kept for "a filter is doing something". Each segment carries a glyph of its
 * own layout beside the number, so the choice reads as density at a glance.
 */
import { Box, Flex, Text, chakra } from "@chakra-ui/react"

import {
  effectiveWallColumns,
  setWallColumns,
  useWallColumns,
  wallColumnOptions,
} from "@/features/showtimes/use-wall-columns"

const SegmentButton = chakra("button")

/** The glyph's box; every option fills the same one, so only density changes. */
const GLYPH_WIDTH = 15
const GLYPH_HEIGHT = 11
const GLYPH_GAP = 1.5

/** `columns` rounded bars filling one box: the wall seen from far away. */
const ColumnsGlyph = ({ columns }: { columns: number }) => {
  const barWidth = (GLYPH_WIDTH - (columns - 1) * GLYPH_GAP) / columns
  return (
    <svg
      width={GLYPH_WIDTH}
      height={GLYPH_HEIGHT}
      viewBox={`0 0 ${GLYPH_WIDTH} ${GLYPH_HEIGHT}`}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {Array.from({ length: columns }, (_, index) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of identical bars
          key={index}
          x={index * (barWidth + GLYPH_GAP)}
          y={0}
          width={barWidth}
          height={GLYPH_HEIGHT}
          rx={1}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

/**
 * `compact` is also "the rail is folded", which is when a fifth ticket a row
 * is on offer (`wallColumnOptions`).
 */
const WallColumnsControl = ({ compact = false }: { compact?: boolean }) => {
  const columns = effectiveWallColumns(useWallColumns(), compact)

  const segments = wallColumnOptions(compact).map((option) => {
    const isOn = option === columns
    return (
      <SegmentButton
        type="button"
        key={option}
        // biome-ignore lint/a11y/useSemanticElements: ARIA radio pattern on a styled button; a native radio input cannot take this styling
        role="radio"
        aria-checked={isOn}
        aria-label={`${option} tickets per row`}
        title={`${option} per row`}
        onClick={() => setWallColumns(option)}
        flex={compact ? undefined : "1"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        gap="7px"
        w={compact ? "36px" : undefined}
        h={compact ? "28px" : undefined}
        py={compact ? 0 : "5px"}
        borderRadius={compact ? "md" : "full"}
        fontSize="13px"
        fontWeight={isOn ? "600" : "500"}
        lineHeight="1.3"
        fontVariantNumeric="tabular-nums"
        cursor="pointer"
        transition="background-color 120ms ease, color 120ms ease"
        // `app.cardBackground` for the thumb in the groove, as `RailSegmented`'s
        // neutral tone: in dark mode the groove and `pillBackground` are one
        // grey. In the strip there is no groove, so the wash marks it instead.
        bg={
          isOn
            ? compact
              ? "app.surfaceMuted"
              : "app.cardBackground"
            : "transparent"
        }
        color={isOn ? "fg" : "fg.muted"}
        boxShadow={isOn && !compact ? "0 1px 2px rgb(0 0 0 / 0.12)" : "none"}
        _hover={isOn ? undefined : { color: "fg" }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "app.tint",
          outlineOffset: "1px",
        }}
      >
        <Box as="span" display="flex" opacity={isOn ? 1 : 0.75}>
          <ColumnsGlyph columns={option} />
        </Box>
        {compact ? null : (
          // Nudged: a digit has no descenders, so centred beside the glyph
          // its ink sits high.
          <Box as="span" position="relative" top="1px">
            {option}
          </Box>
        )}
      </SegmentButton>
    )
  })

  if (compact) {
    return (
      <Flex
        role="radiogroup"
        aria-label="Tickets per row"
        direction="column"
        gap="2px"
      >
        {segments}
      </Flex>
    )
  }

  return (
    <Flex
      align="center"
      justify="space-between"
      gap={3}
      px={3}
      py="8px"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      boxShadow="sm"
    >
      <Text
        fontSize="11px"
        fontWeight="700"
        textTransform="uppercase"
        letterSpacing="0.6px"
        color="fg"
        whiteSpace="nowrap"
        position="relative"
        top="1px"
      >
        Tickets per row
      </Text>
      <Flex
        role="radiogroup"
        aria-label="Tickets per row"
        flex="1"
        maxW="200px"
        p="2px"
        borderRadius="full"
        bg="app.surfaceMuted"
      >
        {segments}
      </Flex>
    </Flex>
  )
}

export default WallColumnsControl
