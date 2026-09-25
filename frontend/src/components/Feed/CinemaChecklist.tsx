/**
 * The cinemas, grouped by city, each with the app's checkmark — a port of
 * `mobile/components/filters/CinemaPickerList.tsx` for the web.
 *
 * Same sections (a city with enough venues gets its own, the rest share "Other
 * cinemas" with the city under each name), same "Select all" / "Deselect all"
 * beside a section's title, same chip: a white pill that, picked, takes the
 * cinema's own accent trio — `primary` fill, `border` outline in light mode and
 * the fill itself in dark, and a round check in the accent's `secondary`.
 *
 * One desktop addition: **double-click a cinema to select only that one.** The
 * two clicks before it toggle the chip off and on again, which is harmless —
 * the double-click then replaces the whole selection, so where it ends up does
 * not depend on where it started.
 *
 * Presentational: the sheet owns the selection.
 */
import { Box, Flex, Text, chakra } from "@chakra-ui/react"
import { memo, useMemo } from "react"
import { MdCheck } from "react-icons/md"
import { getCinemaPaletteKey } from "shared/cinemas/cinema-color"
import type { CinemaPublic } from "shared/client"
import { groupCinemas } from "shared/filters/cinema-grouping"

const ChipButton = chakra("button")
const SectionAction = chakra("button")

const CinemaChip = memo(function CinemaChip({
  cinema,
  showCity,
  isSelected,
  onToggle,
  onOnly,
}: {
  cinema: CinemaPublic
  showCity: boolean
  isSelected: boolean
  onToggle: (cinemaId: number) => void
  onOnly: (cinemaId: number) => void
}) {
  const key = getCinemaPaletteKey(cinema)
  return (
    <ChipButton
      type="button"
      // biome-ignore lint/a11y/useSemanticElements: ARIA checkbox pattern on a styled button; a native checkbox cannot take this styling
      role="checkbox"
      aria-checked={isSelected}
      aria-label={cinema.name}
      title="Double-click to select only this cinema"
      onClick={() => onToggle(cinema.id)}
      onDoubleClick={() => onOnly(cinema.id)}
      display="inline-flex"
      alignItems="center"
      columnGap="6px"
      maxW="100%"
      px="8px"
      py="6px"
      borderRadius="10px"
      borderWidth="1px"
      // Light mode needs the accent's outline to hold a pale fill against the
      // white pill; in dark the fill already separates itself, and the accent's
      // `border` there is a near-white hairline — so the border is the fill.
      borderColor={
        isSelected
          ? { base: `app.${key}.border`, _dark: `app.${key}.primary` }
          : "app.pillBorder"
      }
      bg={isSelected ? `app.${key}.primary` : "app.pillBackground"}
      color="fg"
      textAlign="left"
      cursor="pointer"
      // A double-click would otherwise select the name's text.
      userSelect="none"
      transition="background-color 100ms ease, border-color 100ms ease"
      _hover={{ borderColor: `app.${key}.border` }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "app.tint",
        outlineOffset: "1px",
      }}
    >
      <Box minW={0} flexShrink={1}>
        <Text fontSize="12px" fontWeight="600" lineHeight="1.3" truncate>
          {cinema.name}
        </Text>
        {showCity ? (
          <Text fontSize="10px" color="fg.muted" lineHeight="1.3" truncate>
            {cinema.city.name}
          </Text>
        ) : null}
      </Box>
      <Flex
        flexShrink={0}
        align="center"
        justify="center"
        boxSize="13px"
        borderRadius="full"
        borderWidth="1.2px"
        // Not the pill tokens: in dark mode those are the chip's own fill, so
        // an unticked box would vanish on it.
        borderColor={isSelected ? `app.${key}.secondary` : "app.checkboxBorder"}
        bg={isSelected ? `app.${key}.secondary` : "app.checkboxBackground"}
        color="app.pillActiveText"
      >
        {isSelected ? <MdCheck size={11} /> : null}
      </Flex>
    </ChipButton>
  )
})

export const CinemaChecklist = ({
  cinemas,
  selectedIds,
  onToggle,
  onOnly,
  onSelect,
  onDeselect,
}: {
  cinemas: readonly CinemaPublic[]
  selectedIds: ReadonlySet<number>
  onToggle: (cinemaId: number) => void
  onOnly: (cinemaId: number) => void
  /** Add a whole city at once. */
  onSelect: (cinemaIds: readonly number[]) => void
  /** Drop a whole city at once. */
  onDeselect: (cinemaIds: readonly number[]) => void
}) => {
  const sections = useMemo(() => {
    const { groupedCities, ungrouped, festivals } = groupCinemas(cinemas)
    return [
      ...groupedCities.map((group) => ({
        key: `city-${group.city.id}`,
        title: group.city.name,
        cinemas: group.cinemas,
        canSelectAll: true,
        showCity: false,
      })),
      // The leftovers span several cities, so "Select all" there would not mean
      // anything a user could predict — the app leaves it off for that reason.
      ...(ungrouped.length > 0
        ? [
            {
              key: "other-cinemas",
              title: "Other cinemas",
              cinemas: ungrouped,
              canSelectAll: false,
              showCity: true,
            },
          ]
        : []),
      // Apart from the cinemas, and only while one is on (the server lists a
      // festival or venue only with screenings coming up).
      ...(festivals.length > 0
        ? [
            {
              key: "festivals",
              title: "Festivals",
              cinemas: festivals,
              canSelectAll: false,
              showCity: true,
            },
          ]
        : []),
    ]
  }, [cinemas])

  return (
    <Flex direction="column" gap="12px">
      {sections.map((section) => {
        const sectionIds = section.cinemas.map((cinema) => cinema.id)
        const isSectionSelected = sectionIds.every((id) => selectedIds.has(id))
        return (
          <Box key={section.key}>
            {/* The action sits beside the title it acts on, not pinned to the
                far edge where it would read as belonging to the row. */}
            <Flex align="center" gap="8px" mb="6px">
              <Text
                fontSize="11px"
                fontWeight="700"
                textTransform="uppercase"
                letterSpacing="0.6px"
                color="fg.muted"
              >
                {section.title}
              </Text>
              {section.canSelectAll ? (
                <SectionAction
                  type="button"
                  onClick={() =>
                    isSectionSelected
                      ? onDeselect(sectionIds)
                      : onSelect(sectionIds)
                  }
                  aria-label={`${isSectionSelected ? "Deselect all" : "Select all"} cinemas in ${section.title}`}
                  bg="transparent"
                  color="app.tint"
                  fontSize="11px"
                  fontWeight="700"
                  cursor="pointer"
                >
                  {isSectionSelected ? "Deselect all" : "Select all"}
                </SectionAction>
              ) : null}
            </Flex>
            <Flex wrap="wrap" gap="6px">
              {section.cinemas.map((cinema) => (
                <CinemaChip
                  key={cinema.id}
                  cinema={cinema}
                  showCity={section.showCity}
                  isSelected={selectedIds.has(cinema.id)}
                  onToggle={onToggle}
                  onOnly={onOnly}
                />
              ))}
            </Flex>
          </Box>
        )
      })}
    </Flex>
  )
}
