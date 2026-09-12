/**
 * The filter rail beside the feed.
 *
 * The app hides all of this behind a button, opens a sheet, and asks you to
 * expand a section before you can toggle anything — six actions to narrow to
 * tonight. A desktop has a column going spare, so the dimensions people
 * actually reach for are open on arrival and one click away, which is the
 * single biggest click-count win the website has over the app.
 *
 * The two long ones are the exception. Cinemas and Letterboxd lists are lists
 * without a ceiling — forty venues across a dozen cities — and leaving them
 * open pushes the card past the bottom of the screen, which costs the rail the
 * pinning that makes it worth having (see `FeedLayout`). They start closed
 * with a summary of what they are doing, exactly as the app's sections do, and
 * exactly as Cineville folds its cities and theatres away.
 *
 * Adding a dimension is a section in this file plus its control. The state,
 * the URL spelling and the API mapping are already in `feed-params.ts` — this
 * component only ever reads `params` and calls `onChange`.
 *
 * "Clear filters" sits in the card's own heading rather than in a bar above the
 * list, because a reset belongs beside the things it resets. It is passed in
 * rather than assumed: on a phone there is no rail, and the reset goes back to
 * the toolbar with the search field.
 */
import { Box, Flex, Stack, Text } from "@chakra-ui/react"
import { memo } from "react"
import {
  RELATIVE_DAY_OPTIONS,
  WEEKDAY_DAY_OPTIONS,
} from "shared/filters/day-filter-utils"
import { TIME_FILTER_PRESETS } from "shared/filters/time-filter-presets"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"
import {
  useFetchCuratedLetterboxdLists,
  useFetchLetterboxdLists,
} from "shared/hooks/useLetterboxdLists"

import { useIsSignedIn } from "@/auth/useSession"
import CinemaPresets from "@/components/Feed/CinemaPresets"
import FeedPresets from "@/components/Feed/FeedPresets"
import {
  RAIL_INK,
  RailActionButton,
  RailPill,
  RailPillRow,
  RailSection,
  RailSegmented,
  type RailSegmentedOption,
  RailSubLabel,
} from "@/components/Feed/FilterRailControls"
import type {
  FeedParams,
  WatchedMode,
  WatchlistMode,
} from "@/features/showtimes/feed-params"
import type { Language } from "shared/client"
import type { SharedTabShowtimeFilter } from "shared/filters/shared-tab-filters"

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

/** What a section's header says when nothing in it is set. */
const NOTHING_SET = "Any"

/**
 * One row per screening, or one per film. A segmented control rather than a
 * checkbox, because it is a choice between two ways of reading the same feed
 * and neither is the absence of the other — the app's own control, with the
 * app's own words for the two sides.
 */
const GROUP_OPTIONS: readonly RailSegmentedOption<boolean>[] = [
  { value: false, label: "Showtimes" },
  { value: true, label: "Movies" },
]

/**
 * Which of your friends' marks to narrow to. "Any" filters nothing, so its
 * thumb is neutral rather than accented; the other two take the tones a status
 * is drawn in everywhere else — orange for interested, green for going.
 */
const FRIEND_STATUS_OPTIONS: readonly RailSegmentedOption<SharedTabShowtimeFilter>[] =
  [
    { value: "all", label: "Any", tone: "neutral" },
    { value: "interested", label: "Interested", tone: "orange" },
    { value: "going", label: "Going", tone: "green" },
  ]

type FeedFilterRailProps = {
  params: FeedParams
  onChange: (patch: Partial<FeedParams>) => void
  /** Saved filter presets. Off on the pages a preset would fight with. */
  showPresets?: boolean
  /**
   * One row per film instead of one per screening. Only the feeds that can
   * actually swap endpoints offer it.
   */
  showGroupToggle?: boolean
  /**
   * Clears every filter. Omitted where the rail is not on screen to hold it —
   * on a phone the toolbar takes the reset back, along with the search field.
   */
  onReset?: () => void
  activeFilterCount?: number
}

/** Add or remove one value from an array dimension. */
const toggleIn = <T,>(values: T[], value: T): T[] =>
  values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value]

/** A collapsed section's header line: the picked labels, or `NOTHING_SET`. */
const summarise = (labels: string[]): string =>
  labels.length ? labels.join(", ") : NOTHING_SET

const FeedFilterRail = memo(function FeedFilterRail({
  params,
  onChange,
  showPresets = true,
  showGroupToggle = false,
  onReset,
  activeFilterCount = 0,
}: FeedFilterRailProps) {
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
      lists:
        mode === "only"
          ? [...new Set([...params.lists, id])]
          : params.lists.filter((entry) => entry !== id),
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

  const dayOptions = [...RELATIVE_DAY_OPTIONS, ...WEEKDAY_DAY_OPTIONS]
  const daySummary = summarise(
    dayOptions
      .filter((option) => params.days.includes(option.token))
      .map((option) => ("shortLabel" in option ? option.shortLabel : option.label)),
  )
  const timeSummary = summarise(
    TIME_FILTER_PRESETS.filter((preset) =>
      params.times.includes(preset.range),
    ).map((preset) => preset.label),
  )
  const runtimeSummary = summarise(
    RUNTIME_PRESETS.filter((preset) =>
      params.runtime.includes(preset.token),
    ).map((preset) => preset.label),
  )
  const languageSummary = summarise(
    LANGUAGE_OPTIONS.filter((option) =>
      params.languages.includes(option.value),
    ).map((option) => option.label),
  )
  const myListsSummary = summarise(
    [
      params.watchlist === "only" ? "Watchlist" : null,
      params.watched === "hide" ? "Unseen" : null,
    ].filter((label): label is string => label !== null),
  )
  const groupSummary =
    GROUP_OPTIONS.find((option) => option.value === params.group)?.label ??
    NOTHING_SET
  const friendStatusSummary =
    FRIEND_STATUS_OPTIONS.find((option) => option.value === params.status)
      ?.label ?? NOTHING_SET
  const cinemaSummary = params.cinemas.length
    ? `${params.cinemas.length} selected`
    : "Your usual"
  const listsSummary = summarise(
    [
      params.lists.length ? `${params.lists.length} only` : null,
      params.excludeLists.length ? `${params.excludeLists.length} hidden` : null,
    ].filter((label): label is string => label !== null),
  )

  // Render/output using the state and derived values prepared above.
  return (
    // The rail paints its own card rather than taking `FeedLayout`'s: it is
    // the one panel with a colour of its own — the brand tint, so the filters
    // read as the app's control surface and not as one more sheet of paper —
    // and its section dividers have to run the full width, which they cannot do
    // inside someone else's padding. Squared corners and no outline, the way
    // Cineville's filter card is cut; the fill is what defines it.
    <Box
      bg="app.green.primary"
      borderRadius="md"
      boxShadow="sm"
      // The last section's header would otherwise sit flush against the corner.
      pb="6px"
    >
      <Flex px={3} pt={3} pb="10px" align="center" justify="space-between" gap={2}>
        <Text fontSize="md" fontWeight="bold" color={RAIL_INK}>
          Filters
        </Text>
        {/* Only offered when there is something to undo — a permanently visible
            "clear" implies there is always something set. It appears inside a
            heading row that is always there, so nothing below it moves. */}
        {onReset && (activeFilterCount > 0 || params.q) ? (
          <RailActionButton onClick={onReset} title="Clear every filter">
            Clear{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </RailActionButton>
        ) : null}
      </Flex>

      {showPresets && isSignedIn ? (
        <RailSection title="Presets">
          <FeedPresets params={params} onChange={onChange} />
        </RailSection>
      ) : null}

      {showGroupToggle ? (
        <RailSection title="Group by" summary={groupSummary}>
          <RailSegmented
            label="Group by"
            options={GROUP_OPTIONS}
            value={params.group}
            onChange={(group) => onChange({ group })}
          />
        </RailSection>
      ) : null}

      {/* A guest has no friends, so this could only ever narrow the feed to
          nothing — a whole section that can only be empty is hidden rather than
          gated, the same call the app makes. */}
      {isSignedIn ? (
        <RailSection title="Marked by friends" summary={friendStatusSummary}>
          <RailSegmented
            label="Marked by friends"
            options={FRIEND_STATUS_OPTIONS}
            value={params.status}
            onChange={(status) => onChange({ status })}
          />
        </RailSection>
      ) : null}

      <RailSection title="Day" summary={daySummary}>
        <Stack gap="7px">
          <RailPillRow>
            {RELATIVE_DAY_OPTIONS.map((option) => (
              <RailPill
                key={option.token}
                label={option.label}
                isOn={params.days.includes(option.token)}
                onToggle={() => toggleDay(option.token)}
              />
            ))}
          </RailPillRow>
          <RailPillRow>
            {WEEKDAY_DAY_OPTIONS.map((option) => (
              <RailPill
                key={option.token}
                label={option.shortLabel}
                isOn={params.days.includes(option.token)}
                onToggle={() => toggleDay(option.token)}
              />
            ))}
          </RailPillRow>
        </Stack>
      </RailSection>

      <RailSection title="Time of day" summary={timeSummary}>
        <RailPillRow>
          {TIME_FILTER_PRESETS.map((preset) => (
            <RailPill
              key={preset.id}
              label={preset.label}
              isOn={params.times.includes(preset.range)}
              onToggle={() => toggleTime(preset.range)}
            />
          ))}
        </RailPillRow>
      </RailSection>

      <RailSection title="Length" summary={runtimeSummary}>
        <RailPillRow>
          {RUNTIME_PRESETS.map((preset) => (
            <RailPill
              key={preset.token}
              label={preset.label}
              isOn={params.runtime.includes(preset.token)}
              onToggle={() => toggleRuntime(preset.token)}
            />
          ))}
        </RailPillRow>
      </RailSection>

      <RailSection title="Language" summary={languageSummary}>
        <Stack gap="7px">
          <RailPillRow>
            {LANGUAGE_OPTIONS.map((option) => (
              <RailPill
                key={option.value}
                label={option.label}
                isOn={params.languages.includes(option.value)}
                onToggle={() => toggleLanguage(option.value)}
              />
            ))}
          </RailPillRow>
          {params.languages.length > 1 ? (
            <Text fontSize="xs" color={RAIL_INK}>
              Showing films in either language.
            </Text>
          ) : null}
        </Stack>
      </RailSection>

      <RailSection title="Your lists" summary={myListsSummary}>
        <RailPillRow>
          <RailPill
            label="On my watchlist"
            isOn={params.watchlist === "only"}
            onToggle={() =>
              onChange({
                watchlist: (params.watchlist === "only"
                  ? "any"
                  : "only") as WatchlistMode,
              })
            }
          />
          <RailPill
            label="Hide films I've seen"
            isOn={params.watched === "hide"}
            onToggle={() =>
              onChange({
                watched: (params.watched === "hide"
                  ? "any"
                  : "hide") as WatchedMode,
              })
            }
          />
        </RailPillRow>
      </RailSection>

      <RailSection title="Cinemas" summary={cinemaSummary} defaultOpen={false}>
        <Stack gap={2}>
          <CinemaPresets params={params} onChange={onChange} />
          {params.cinemas.length ? (
            <Box>
              <RailActionButton onClick={() => onChange({ cinemas: [] })}>
                Clear {params.cinemas.length} selected
              </RailActionButton>
            </Box>
          ) : (
            <Text fontSize="xs" color={RAIL_INK}>
              Nothing selected — showing your usual cinemas.
            </Text>
          )}
          {/* Chips, not a checkbox column: it is what the app's cinema picker
              uses, it is legible on the tint where a checkbox control is not,
              and forty of them wrapping across the card is what the rail's
              width is for. */}
          {[...cinemasByCity.entries()].map(([city, cityCinemas]) => (
            <Box key={city}>
              <RailSubLabel label={city} />
              <RailPillRow>
                {(cityCinemas ?? []).map((cinema) => (
                  <RailPill
                    key={cinema.id}
                    label={cinema.name}
                    isOn={params.cinemas.includes(cinema.id)}
                    onToggle={() => toggleCinema(cinema.id)}
                  />
                ))}
              </RailPillRow>
            </Box>
          ))}
        </Stack>
      </RailSection>

      {lists.length ? (
        <RailSection
          title="Letterboxd lists"
          summary={listsSummary}
          defaultOpen={false}
        >
          <Stack gap={2}>
            {lists.map((list) => {
              const isOnly = params.lists.includes(list.id)
              const isHidden = params.excludeLists.includes(list.id)
              const name = list.title ?? list.list_slug
              return (
                <Box key={list.id}>
                  <Text
                    fontSize="sm"
                    color={RAIL_INK}
                    truncate
                    title={name}
                    mb="4px"
                  >
                    {name}
                  </Text>
                  <RailPillRow>
                    <RailPill
                      label="Only"
                      title={`Show only films on ${name}`}
                      isOn={isOnly}
                      onToggle={() => setListMode(list.id, isOnly ? "off" : "only")}
                    />
                    <RailPill
                      label="Hide"
                      tone="red"
                      title={`Hide films on ${name}`}
                      isOn={isHidden}
                      onToggle={() =>
                        setListMode(list.id, isHidden ? "off" : "hide")
                      }
                    />
                  </RailPillRow>
                </Box>
              )
            })}
          </Stack>
        </RailSection>
      ) : null}
    </Box>
  )
})

export default FeedFilterRail
