/**
 * The filter rail beside the feed.
 *
 * The app hides all of this behind a button, opens a sheet, and asks you to
 * expand a section before you can toggle anything — six actions to narrow to
 * tonight. A desktop has a column going spare, so every dimension here is
 * visible and one click away, which is the single biggest click-count win the
 * website has over the app.
 *
 * Adding a dimension is a section in this file plus its control. The state,
 * the URL spelling and the API mapping are already in `feed-params.ts` — this
 * component only ever reads `params` and calls `onChange`.
 */
import { Box, Button, Flex, Heading, Stack, Text } from "@chakra-ui/react"
import type { ReactNode } from "react"
import {
  RELATIVE_DAY_OPTIONS,
  WEEKDAY_DAY_OPTIONS,
} from "shared/filters/day-filter-utils"
import { TIME_FILTER_PRESETS } from "shared/filters/time-filter-presets"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"

import { Checkbox } from "@/components/ui/checkbox"
import type {
  FeedParams,
  WatchedMode,
  WatchlistMode,
} from "@/features/showtimes/feed-params"

type FeedFilterRailProps = {
  params: FeedParams
  onChange: (patch: Partial<FeedParams>) => void
}

/** One heading + its controls. Every section in the rail uses this. */
const Section = ({
  title,
  children,
}: { title: string; children: ReactNode }) => (
  <Box>
    <Heading size="xs" textTransform="uppercase" color="gray.500" mb={2}>
      {title}
    </Heading>
    <Stack gap={1}>{children}</Stack>
  </Box>
)

/** A toggle in a set where any number may be on. */
const TokenToggle = ({
  label,
  isOn,
  onToggle,
}: { label: string; isOn: boolean; onToggle: () => void }) => (
  <Button
    size="xs"
    variant={isOn ? "solid" : "surface"}
    colorPalette={isOn ? "green" : "gray"}
    onClick={onToggle}
    justifyContent="flex-start"
  >
    {label}
  </Button>
)

/** Add or remove one value from an array dimension. */
const toggleIn = <T,>(values: T[], value: T): T[] =>
  values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value]

const FeedFilterRail = ({ params, onChange }: FeedFilterRailProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const { data: cinemas } = useFetchCinemas()

  const toggleDay = (token: string) =>
    onChange({ days: toggleIn(params.days, token) })

  // One range at a time, matching the app: `normalizeSingleTimeRangeSelection`
  // keeps only the first, so offering multi-select here would silently drop the
  // rest.
  const toggleTime = (range: string) =>
    onChange({ times: params.times.includes(range) ? [] : [range] })

  const toggleCinema = (id: number) =>
    onChange({ cinemas: toggleIn(params.cinemas, id) })

  // Cinemas are grouped by city, which is how anyone actually picks them.
  const cinemasByCity = new Map<string, typeof cinemas>()
  for (const cinema of cinemas ?? []) {
    const city = cinema.city.name
    if (!cinemasByCity.has(city)) cinemasByCity.set(city, [])
    cinemasByCity.get(city)?.push(cinema)
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Stack gap={5}>
      <Section title="Day">
        <Flex wrap="wrap" gap={1}>
          {RELATIVE_DAY_OPTIONS.map((option) => (
            <TokenToggle
              key={option.token}
              label={option.label}
              isOn={params.days.includes(option.token)}
              onToggle={() => toggleDay(option.token)}
            />
          ))}
        </Flex>
        <Flex wrap="wrap" gap={1}>
          {WEEKDAY_DAY_OPTIONS.map((option) => (
            <TokenToggle
              key={option.token}
              label={option.shortLabel}
              isOn={params.days.includes(option.token)}
              onToggle={() => toggleDay(option.token)}
            />
          ))}
        </Flex>
      </Section>

      <Section title="Time of day">
        <Flex wrap="wrap" gap={1}>
          {TIME_FILTER_PRESETS.map((preset) => (
            <TokenToggle
              key={preset.id}
              label={preset.label}
              isOn={params.times.includes(preset.range)}
              onToggle={() => toggleTime(preset.range)}
            />
          ))}
        </Flex>
      </Section>

      <Section title="Your lists">
        <Checkbox
          checked={params.watchlist === "only"}
          onCheckedChange={(details) =>
            onChange({
              watchlist: (details.checked ? "only" : "any") as WatchlistMode,
            })
          }
        >
          <Text fontSize="sm">On my watchlist</Text>
        </Checkbox>
        <Checkbox
          checked={params.watched === "hide"}
          onCheckedChange={(details) =>
            onChange({
              watched: (details.checked ? "hide" : "any") as WatchedMode,
            })
          }
        >
          <Text fontSize="sm">Hide films I've seen</Text>
        </Checkbox>
      </Section>

      <Section title="Cinemas">
        {params.cinemas.length ? (
          <Button
            size="xs"
            variant="ghost"
            alignSelf="flex-start"
            onClick={() => onChange({ cinemas: [] })}
          >
            Clear {params.cinemas.length} selected
          </Button>
        ) : (
          <Text fontSize="xs" color="gray.500">
            Nothing selected — showing your usual cinemas.
          </Text>
        )}
        {[...cinemasByCity.entries()].map(([city, cityCinemas]) => (
          <Box key={city} mt={2}>
            <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={1}>
              {city}
            </Text>
            <Stack gap={0.5}>
              {(cityCinemas ?? []).map((cinema) => (
                <Checkbox
                  key={cinema.id}
                  checked={params.cinemas.includes(cinema.id)}
                  onCheckedChange={() => toggleCinema(cinema.id)}
                >
                  <Text fontSize="sm">{cinema.name}</Text>
                </Checkbox>
              ))}
            </Stack>
          </Box>
        ))}
      </Section>
    </Stack>
  )
}

export default FeedFilterRail
