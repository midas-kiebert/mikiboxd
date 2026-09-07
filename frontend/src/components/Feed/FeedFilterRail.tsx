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
import {
  useFetchCuratedLetterboxdLists,
  useFetchLetterboxdLists,
} from "shared/hooks/useLetterboxdLists"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"

import { useIsSignedIn } from "@/auth/useSession"
import { Checkbox } from "@/components/ui/checkbox"
import type {
  FeedParams,
  WatchedMode,
  WatchlistMode,
} from "@/features/showtimes/feed-params"
import type { Language } from "shared/client"

/**
 * Runtime is one range at a time, like time of day. The app offers a slider;
 * three buckets cover what anyone actually filters for and cost one click
 * instead of two drags.
 */
const RUNTIME_PRESETS: { token: string; label: string }[] = [
  { token: "5-90", label: "Under 1½h" },
  { token: "90-120", label: "1½–2h" },
  { token: "120-200", label: "Over 2h" },
]

/** OR, not AND: picking both is "either language", which is what people mean. */
const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "nl", label: "Dutch" },
]

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

  // Signed in, the account endpoint already returns the curated lists alongside
  // the user's own, so only one of these two ever runs.
  const isSignedIn = useIsSignedIn()
  const { data: ownLists } = useFetchLetterboxdLists(isSignedIn)
  const { data: curatedLists } = useFetchCuratedLetterboxdLists(!isSignedIn)
  const lists = (isSignedIn ? ownLists : curatedLists) ?? []

  const toggleDay = (token: string) =>
    onChange({ days: toggleIn(params.days, token) })

  // One range at a time, matching the app: `normalizeSingleTimeRangeSelection`
  // keeps only the first, so offering multi-select here would silently drop the
  // rest.
  const toggleTime = (range: string) =>
    onChange({ times: params.times.includes(range) ? [] : [range] })

  const toggleCinema = (id: number) =>
    onChange({ cinemas: toggleIn(params.cinemas, id) })

  // Single-select, matching normalizeSingleRuntimeRangeSelection.
  const toggleRuntime = (token: string) =>
    onChange({ runtime: params.runtime.includes(token) ? [] : [token] })

  const toggleLanguage = (value: Language) =>
    onChange({ languages: toggleIn(params.languages, value) })

  /**
   * A list is off, included, or excluded — never both at once, so picking one
   * side clears the other.
   */
  const setListMode = (id: string, mode: "off" | "only" | "hide") =>
    onChange({
      lists: mode === "only" ? [...new Set([...params.lists, id])] : params.lists.filter((entry) => entry !== id),
      excludeLists:
        mode === "hide"
          ? [...new Set([...params.excludeLists, id])]
          : params.excludeLists.filter((entry) => entry !== id),
    })

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

      <Section title="Length">
        <Flex wrap="wrap" gap={1}>
          {RUNTIME_PRESETS.map((preset) => (
            <TokenToggle
              key={preset.token}
              label={preset.label}
              isOn={params.runtime.includes(preset.token)}
              onToggle={() => toggleRuntime(preset.token)}
            />
          ))}
        </Flex>
      </Section>

      <Section title="Language">
        <Flex wrap="wrap" gap={1}>
          {LANGUAGE_OPTIONS.map((option) => (
            <TokenToggle
              key={option.value}
              label={option.label}
              isOn={params.languages.includes(option.value)}
              onToggle={() => toggleLanguage(option.value)}
            />
          ))}
        </Flex>
        {params.languages.length > 1 ? (
          <Text fontSize="xs" color="gray.500">
            Showing films in either language.
          </Text>
        ) : null}
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

      {lists.length ? (
        <Section title="Letterboxd lists">
          {lists.map((list) => {
            const isOnly = params.lists.includes(list.id)
            const isHidden = params.excludeLists.includes(list.id)
            return (
              <Flex key={list.id} align="center" gap={1} justify="space-between">
                <Text fontSize="sm" truncate title={list.title ?? list.list_slug}>
                  {list.title ?? list.list_slug}
                </Text>
                <Flex gap={1} flexShrink={0}>
                  <Button
                    size="2xs"
                    variant={isOnly ? "solid" : "surface"}
                    colorPalette={isOnly ? "green" : "gray"}
                    onClick={() => setListMode(list.id, isOnly ? "off" : "only")}
                  >
                    Only
                  </Button>
                  <Button
                    size="2xs"
                    variant={isHidden ? "solid" : "surface"}
                    colorPalette={isHidden ? "red" : "gray"}
                    onClick={() => setListMode(list.id, isHidden ? "off" : "hide")}
                  >
                    Hide
                  </Button>
                </Flex>
              </Flex>
            )
          })}
        </Section>
      ) : null}
    </Stack>
  )
}

export default FeedFilterRail
