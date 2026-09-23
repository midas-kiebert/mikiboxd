/**
 * The filter rail beside the feed.
 *
 * Top to bottom, in the order the product ranks them:
 *
 *     Cinemas         what you are looking at, your sets, "Select cinemas"
 *     Quick filters   your saved filter presets
 *     Feed style      ticket wall or movie rows, and making that the default
 *     Letterboxd      watchlist · already seen, or — with no username linked
 *                     yet — a field to link one, the two switches greyed out
 *     Language        English subtitled (or spoken) only, and making that
 *                     the default
 *     When            days, and time of day on the app's slider
 *     More filters    friends, lists, and film length on the app's slider
 *     Clear filters   a full-width button pinned to the bottom of the rail
 *
 * When and More filters start folded, so a filter in either could be on with
 * nothing on screen saying so. Folded, each lists what it holds as the app's
 * active-filter chips, one per filter, each one click from off.
 *
 * "Select cinemas" opens the cinema sheet glued to this rail's right edge (see
 * `CinemaSheet`). While it is out the rail stays live and the rest of the page
 * does not: this component lifts itself above the sheet's scrim, and the
 * cinema summary follows the sheet's draft so the two never disagree.
 *
 * Adding a dimension is a section in this file plus its control. The state, the
 * URL spelling and the API mapping are already in `feed-params.ts` — this
 * component only ever reads `params` and calls `onChange`.
 *
 * `params` and `onChange` are already the optimistic pair `useFeedParams`
 * keeps (the URL write is deferred past the press's own frame), so every
 * control here — switches, pills, cinema sets, chips, presets, Clear —
 * answers in the frame it is clicked, and so does the feed beside it.
 */
import { Box, Flex, Stack, chakra } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, memo, useEffect, useRef, useState } from "react"
import { MdCheck, MdFilterAltOff } from "react-icons/md"
import { type Language, MeService } from "shared/client"
import { serializeCinemaIds } from "shared/filters/cinema-grouping"
import {
  commitCinemaSelection,
  resolveCinemaSelection,
} from "shared/filters/cinema-selection"
import {
  RELATIVE_DAY_OPTIONS,
  WEEKDAY_DAY_OPTIONS,
  getDaySelectionLabel,
  isIsoDaySelection,
} from "shared/filters/day-filter-utils"
import useAuth from "shared/hooks/useAuth"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"
import { useFetchFriends } from "shared/hooks/useFetchFriends"
import {
  useFetchCuratedLetterboxdLists,
  useFetchLetterboxdLists,
} from "shared/hooks/useLetterboxdLists"

import { useIsSignedIn, useRequireAccount } from "@/auth/useSession"
import { CinemaSection } from "@/components/Feed/CinemaSection"
import { CinemaSheet, SHEET_EXIT_MS } from "@/components/Feed/CinemaSheet"
import {
  RAISED_PANEL_ATTRIBUTE,
  RAISED_PANEL_Z_INDEX,
} from "@/components/Feed/FeedLayout"
import FeedPresets from "@/components/Feed/FeedPresets"
import { useFriendStatus } from "@/components/Feed/FeedSubjectHeader"
import {
  type RailChipItem,
  RailFacetHeading,
  RailInput,
  RailModeRow,
  RailNote,
  RailPart,
  RailPartLabel,
  RailPill,
  RailPillRow,
  RailSection,
  RailSegmented,
  type RailSegmentedOption,
  RailSwitchRow,
  RailTextButton,
  summarizeChipValues,
} from "@/components/Feed/FilterRailControls"
import { FriendFilter } from "@/components/Feed/FriendFilter"
import { usePreferredCinemasSave } from "@/components/Feed/PreferredCinemasPrompt"
import {
  RUNTIME_SCALE,
  RangeSlider,
  TIME_SCALE,
} from "@/components/Feed/RangeSlider"
import { FriendButton } from "@/components/Friends/friend-controls"
import { personName } from "@/components/Showtimes/detail/PersonAvatar"
import {
  type FeedParams,
  defaultFeedParams,
} from "@/features/showtimes/feed-params"
import { usePreferredCinemaIds } from "@/features/showtimes/guest-preferred-cinemas"
import { useCinemaPresetState } from "@/features/showtimes/use-cinema-preset-state"
import { useRememberedFeedStyle } from "@/features/showtimes/use-remembered-feed-style"
import { useRememberedLanguage } from "@/features/showtimes/use-remembered-language"
import useCustomToast from "@/hooks/useCustomToast"
import type { SharedTabShowtimeFilter } from "shared/filters/shared-tab-filters"

import "./FeedFilterRail.css"
// The Letterboxd field borrows the settings page's `.st-affix`/`.st-input`.
import "@/components/Settings/settings.css"

/** The one language the toggle is about — matches spoken *or* subtitled. */
const ENGLISH: Language = "en"

/**
 * Above the scrim the cinema sheet paints over the page, so the rail stays
 * bright and clickable beside it. Only while the sheet is out — and above the
 * root layout's own notice banner (`zIndex={2000}` in `routes/__root.tsx`), or
 * that one strip of the page would stay lit through the dim.
 *
 * Must match `SHEET_Z_INDEX` in `CinemaSheet.tsx`, which portals the sheet
 * itself to `document.body` — otherwise a card in a "Ticket wall" grid, whose
 * cell always establishes its own stacking context (`content-visibility:
 * auto`), paints over both the rail and the sheet regardless of how high this
 * number is.
 */
const RAISED_Z_INDEX = RAISED_PANEL_Z_INDEX

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
   * Only the filters that narrow a film's screenings — cinemas, language,
   * when, and whose plans — for a page that is about one film already. The
   * ones that choose films (watchlist, seen, lists, length) are left out, and
   * so are quick filters, which would put them back. The page pins those
   * dimensions (`FILM_LEVEL_FEED_PARAMS`), so nothing can hold them on.
   */
  screeningsOnly?: boolean
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

const DefaultButton = chakra("button")

/**
 * "Make this the default", on the section heading's own line — or, greyed
 * and inert, "This is the default" once it is.
 *
 * A button rather than a "remember my choice" checkbox: a remembered choice
 * followed every flip of the control, so a one-off change or a preset quietly
 * rewrote it. Here the control only ever changes this visit, and the default
 * changes only when you say so. Quiet — muted words, no fill — and always
 * there, so the heading row never changes height.
 */
const MakeDefault = ({
  isDefault,
  onMakeDefault,
  title,
}: {
  isDefault: boolean
  onMakeDefault: () => void
  title: string
}) => (
  <DefaultButton
    type="button"
    disabled={isDefault}
    onClick={onMakeDefault}
    title={isDefault ? undefined : title}
    display="inline-flex"
    alignItems="center"
    gap="4px"
    px="4px"
    py="1px"
    borderRadius="4px"
    bg="transparent"
    color={isDefault ? "fg.subtle" : "app.tint"}
    fontSize="11px"
    fontWeight="600"
    cursor={isDefault ? "default" : "pointer"}
    _hover={isDefault ? undefined : { textDecoration: "underline" }}
    _focusVisible={{ outline: "2px solid", outlineColor: "app.tint" }}
  >
    {isDefault ? <MdCheck size={11} /> : null}
    {/* Nudged: a no-descender line's own line-box leaves empty space below
        the letters, so centering it against the icon lands the ink high. */}
    <Box as="span" position="relative" top="1px">
      {isDefault ? "This is the default" : "Make this the default"}
    </Box>
  </DefaultButton>
)

const FEED_STYLE_OPTIONS: readonly RailSegmentedOption<boolean>[] = [
  { value: false, label: "Ticket wall", tone: "neutral" },
  { value: true, label: "Film rows", tone: "neutral" },
]

/**
 * Link a Letterboxd username from the rail itself, shown in place of nothing
 * while the watchlist and already-seen switches below it cannot work yet. The
 * same write as the settings page's field.
 */
const LetterboxdLink = () => {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const requireAccount = useRequireAccount()
  const [username, setUsername] = useState("")
  const trimmed = username.trim()

  const save = useMutation({
    mutationFn: (value: string) =>
      MeService.updateUserMe({ requestBody: { letterboxd_username: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["currentUser"], updated)
      queryClient.invalidateQueries({ queryKey: ["showtimes"] })
      queryClient.invalidateQueries({ queryKey: ["movies"] })
    },
    onError: () =>
      showErrorToast("Your Letterboxd username was not saved. Try again."),
  })

  const submit = () => {
    if (!trimmed || save.isPending || !requireAccount()) return
    save.mutate(trimmed)
  }

  return (
    <Stack gap="6px" mb="6px" px="2px">
      <RailNote>
        Link your Letterboxd username to filter by your watchlist and the films
        you have seen.
      </RailNote>
      {/* The settings page's own field and button (`Settings/LetterboxdSection`),
          so linking looks the same wherever it is done. */}
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          submit()
        }}
      >
        <Flex gap="6px" align="center">
          <div className="st-affix" style={{ flex: 1, minWidth: 0 }}>
            <span className="st-affix__prefix">letterboxd.com/</span>
            <input
              className="st-input"
              aria-label="Letterboxd username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={save.isPending}
            />
          </div>
          <FriendButton
            primary
            busy={!trimmed || save.isPending}
            onClick={submit}
          >
            {save.isPending ? "Saving…" : "Save"}
          </FriendButton>
        </Flex>
      </form>
    </Stack>
  )
}

const ClearButton = chakra("button")

/**
 * Clear filters, pinned to the bottom of the rail so it is on screen however
 * far down the filters you are, and a full-width button so it is easy to hit.
 *
 * Always there, never appearing: a button that turns up with the first filter
 * would move everything under the pointer. With nothing on it says so and
 * rests; with something on it takes the soft accent the app gives an action
 * with something to do.
 */
const ClearFiltersButton = ({
  count,
  hasSearch,
  onClear,
}: {
  count: number
  hasSearch: boolean
  onClear: () => void
}) => {
  const hasSomethingToClear = count > 0 || hasSearch
  return (
    <Box
      position="sticky"
      bottom={0}
      zIndex={1}
      bg="bg.panel"
      borderTopWidth="1px"
      borderColor="border"
      px="12px"
      py="10px"
      mt="4px"
    >
      <ClearButton
        type="button"
        onClick={onClear}
        disabled={!hasSomethingToClear}
        w="100%"
        h="38px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        gap="8px"
        borderRadius="10px"
        borderWidth="1px"
        borderColor="app.green.border"
        bg="app.green.primary"
        color="app.green.secondary"
        fontSize="13px"
        fontWeight="700"
        cursor="pointer"
        transition="background-color 120ms ease"
        _hover={{ filter: "brightness(0.97)" }}
        _disabled={{
          borderColor: "app.pillBorder",
          bg: "transparent",
          color: "fg.subtle",
          cursor: "default",
          filter: "none",
        }}
      >
        <MdFilterAltOff size={17} />
        <Box as="span" position="relative" top="1px">
          {count === 0
            ? "No filters on"
            : `Clear ${count} filter${count === 1 ? "" : "s"}`}
        </Box>
      </ClearButton>
    </Box>
  )
}

const FeedFilterRail = memo(function FeedFilterRail({
  params,
  onChange,
  showPresets = true,
  showGroupToggle = false,
  screeningsOnly = false,
  onReset,
  activeFilterCount = 0,
}: FeedFilterRailProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const { data: cinemas } = useFetchCinemas()

  const isSignedIn = useIsSignedIn()
  const { data: friends = [] } = useFetchFriends({ enabled: isSignedIn })
  const { data: preferredCinemaIds } = usePreferredCinemaIds()

  const presetState = useCinemaPresetState({ isSignedIn, preferredCinemaIds })
  const preferredSave = usePreferredCinemasSave(presetState)
  const { data: ownLists } = useFetchLetterboxdLists(isSignedIn)
  const { data: curatedLists } = useFetchCuratedLetterboxdLists(!isSignedIn)
  const lists = (isSignedIn ? ownLists : curatedLists) ?? []

  const [dateDraft, setDateDraft] = useState("")
  const cardRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  /** The sheet's selection while it is out; null while it is closed. */
  const [draftIds, setDraftIds] = useState<number[] | null>(null)
  // The selection a just-closed sheet holds while it slides away. It is
  // applied once the sheet is gone, not as it starts to go: a new selection
  // re-renders the whole feed, and started first, that work held the slide
  // back until the sheet was already due to unmount — so it snapped shut.
  const [leavingIds, setLeavingIds] = useState<number[] | null>(null)
  const commitAfterExitRef = useRef<(ids: number[]) => void>(() => {})
  useEffect(() => {
    if (leavingIds === null) return
    const timer = setTimeout(() => {
      commitAfterExitRef.current(leavingIds)
      setLeavingIds(null)
    }, SHEET_EXIT_MS)
    return () => clearTimeout(timer)
  }, [leavingIds])

  const toggleDay = (token: string) =>
    onChange({ days: toggleIn(params.days, token) })

  const remembered = useRememberedLanguage({
    current: params.languages,
    apply: (languages) => onChange({ languages: languages as Language[] }),
  })
  const isEnglishOnly = params.languages.includes(ENGLISH)

  const rememberedStyle = useRememberedFeedStyle({
    current: params.group,
    apply: (group) => onChange({ group }),
    enabled: showGroupToggle && !screeningsOnly,
  })
  const { user } = useAuth()
  const hasLetterboxd = Boolean(user?.letterboxd_username?.trim())

  const allCinemaIds = (cinemas ?? []).map((cinema) => cinema.id)

  /**
   * The cinemas the feed is actually showing, which is not the same as what the
   * URL says. An empty `?cinemas=` means "whatever this account usually
   * watches", so the summary resolves the same three layers the feed itself
   * does — see `shared/filters/cinema-selection`.
   */
  const committedCinemaIds = resolveCinemaSelection({
    sessionCinemaIds: params.cinemas.length ? params.cinemas : undefined,
    preferredCinemaIds,
    allCinemaIds,
  })
  const isCinemaSheetOpen = draftIds !== null
  const shownCinemaIds = draftIds ?? leavingIds ?? committedCinemaIds

  const commitCinemas = (ids: number[]) => {
    if (serializeCinemaIds(ids) !== serializeCinemaIds(committedCinemaIds)) {
      onChange({ cinemas: commitCinemaSelection(ids, allCinemaIds) })
    }
  }
  commitAfterExitRef.current = commitCinemas

  /** From the sheet: slide it away, then commit. From the rail: commit now. */
  const applyCinemas = (ids: number[]) => {
    if (draftIds !== null) {
      setLeavingIds(ids)
    } else {
      // A set picked while the last sheet is still leaving supersedes it.
      setLeavingIds(null)
      commitCinemas(ids)
    }
    setDraftIds(null)
    triggerRef.current?.focus({ preventScroll: true })
  }

  /** Reopened mid-exit, the sheet picks up the selection it was leaving with. */
  const openCinemaSheet = () => {
    setDraftIds(leavingIds ?? committedCinemaIds)
    setLeavingIds(null)
  }

  const isoDays = params.days.filter(isIsoDaySelection)

  const runtimeOn = params.runtime.length > 0
  const friendStatusOn = params.status !== "all" || params.mine
  const listsOn = params.lists.length > 0 || params.excludeLists.length > 0

  // The folded sections' chips — the app's labels, one chip per filter.
  const dayLabels = params.days.map(getDaySelectionLabel)
  const whenChips: RailChipItem[] = [
    ...(dayLabels.length
      ? [
          {
            key: "days",
            label: summarizeChipValues(dayLabels),
            title: `Days: ${dayLabels.join(", ")}`,
            onRemove: () => onChange({ days: [] }),
          },
        ]
      : []),
    ...(params.times.length
      ? [
          {
            key: "times",
            label: TIME_SCALE.describe(params.times),
            onRemove: () => onChange({ times: [] }),
          },
        ]
      : []),
  ]

  const listTitle = (listId: string) => {
    const list = lists.find((entry) => entry.id === listId)
    return list ? (list.title ?? list.list_slug) : "List"
  }
  const shownListTitles = params.lists.map(listTitle)
  const hiddenListTitles = params.excludeLists.map(listTitle)
  const friendNames = params.friends
    .map((id) => friends.find((friend) => friend.id === id))
    .filter((friend) => friend !== undefined)
    .map((friend) => personName(friend))
  // One person who isn't in the friends list (a non-friend's page): name them
  // from their own status lookup — the header's, so no extra request — rather
  // than calling them "1 friend".
  const loneId =
    params.friends.length === 1 && !friendNames.length
      ? params.friends[0]
      : null
  const { data: lonePerson } = useFriendStatus(loneId)
  if (lonePerson) friendNames.push(personName(lonePerson))
  const moreChips: RailChipItem[] = [
    ...(friendStatusOn
      ? [
          {
            key: "status",
            // "Friends …" rather than the app's bare "Going": down here, away
            // from the control it came from, a lone "Going" reads as your own.
            // With "only mine" on it *is* your own, which is your agenda.
            label: params.mine
              ? params.status === "going"
                ? "You're going"
                : "Your plans"
              : params.status === "going"
                ? "Friends going"
                : "Friends interested",
            onRemove: () => onChange({ status: "all" as const, mine: false }),
          },
        ]
      : []),
    ...(params.friends.length
      ? [
          {
            key: "friends",
            label:
              params.friends.length === 1
                ? `Only ${friendNames[0] ?? "1 person"}`
                : `Only ${params.friends.length} friends`,
            title: friendNames.length
              ? `Only: ${friendNames.join(", ")}`
              : undefined,
            onRemove: () => onChange({ friends: [] }),
          },
        ]
      : []),
    ...(shownListTitles.length
      ? [
          {
            key: "lists-include",
            label: summarizeChipValues(shownListTitles),
            title: `Lists: ${shownListTitles.join(", ")}`,
            onRemove: () => onChange({ lists: [] }),
          },
        ]
      : []),
    ...(hiddenListTitles.length
      ? [
          {
            key: "lists-exclude",
            label: summarizeChipValues(hiddenListTitles),
            excludes: true,
            title: `Hide lists: ${hiddenListTitles.join(", ")}`,
            onRemove: () => onChange({ excludeLists: [] }),
          },
        ]
      : []),
    ...(runtimeOn
      ? [
          {
            key: "runtime",
            label: RUNTIME_SCALE.describe(params.runtime),
            onRemove: () => onChange({ runtime: [] }),
          },
        ]
      : []),
  ]

  /**
   * A default language is not a filter — the same reason
   * the account's own preferred cinemas don't count toward `activeFilterCount`
   * (`countActiveFilters` in `feed-params.ts`, which has no way to know about
   * this device-local preference). Subtracted here rather than there, since
   * only this rail knows about it.
   */
  const isRememberedLanguageOn =
    remembered.isDefault && remembered.defaultLanguages.length > 0
  const displayedFilterCount = Math.max(
    0,
    activeFilterCount - (isRememberedLanguageOn ? 1 : 0),
  )

  /**
   * Clears every dimension, language back to its default rather than to off —
   * clearing to off would mean "clear filters" quietly overriding a standing
   * preference, the same trap an empty
   * `?cinemas=` would be without `resolveCinemaSelection`. One `onChange` with
   * every `FeedParams` key set explicitly, rather than calling `onReset` and
   * patching languages after: `onReset` navigates to `search: {}`, and a
   * second call in the same tick would merge onto *this render's* `params`,
   * not the reset ones — the navigation hasn't landed yet. Spelling out every
   * key sidesteps that regardless of ordering.
   */
  const clearFilters = () => {
    onChange({
      ...defaultFeedParams,
      languages: [...remembered.defaultLanguages],
      // The feed style is a view, not a filter — clearing never changes it.
      group: params.group,
    })
  }

  const isRaised = isCinemaSheetOpen || leavingIds !== null

  // Render/output using the state and derived values prepared above.
  return (
    // Position: relative so the card can lift above the cinema sheet's scrim
    // while the sheet is out, and drop back into normal stacking once it isn't.
    <Box
      position="relative"
      zIndex={isRaised ? RAISED_Z_INDEX : undefined}
      // Tells a floating rail column to come up with it (`FeedLayout`).
      {...(isRaised ? { [RAISED_PANEL_ATTRIBUTE]: "" } : {})}
    >
      <Box ref={cardRef} className="mk-rail" boxShadow="sm" pb="6px">
        <CinemaSection
          cinemas={cinemas ?? []}
          shownIds={shownCinemaIds}
          isOpen={isCinemaSheetOpen}
          onToggleOpen={() =>
            isCinemaSheetOpen ? applyCinemas(shownCinemaIds) : openCinemaSheet()
          }
          // A set clicked while the sheet is out goes into the sheet, not the
          // feed — the sheet is still being decided.
          onChoose={(ids) =>
            isCinemaSheetOpen ? setDraftIds([...ids]) : applyCinemas(ids)
          }
          presetState={presetState}
          // A guest's set is kept in this browser (`guest-preferred-cinemas`).
          onSavePreferred={() => preferredSave.save(shownCinemaIds)}
          triggerRef={triggerRef}
        />

        {showPresets && isSignedIn && !screeningsOnly ? (
          <RailPart>
            <FeedPresets
              params={params}
              onChange={onChange}
              activeFilterCount={activeFilterCount}
            />
          </RailPart>
        ) : null}

        {showGroupToggle && !screeningsOnly ? (
          <RailPart>
            <Flex
              align="center"
              justify="space-between"
              gap="8px"
              minH="18px"
              mb="6px"
            >
              <RailPartLabel>Feed style</RailPartLabel>
              <MakeDefault
                isDefault={rememberedStyle.isDefault}
                onMakeDefault={rememberedStyle.makeDefault}
                title="Open the feed in this style every time, on this device"
              />
            </Flex>
            <RailSegmented
              label="Feed style"
              options={FEED_STYLE_OPTIONS}
              value={params.group}
              onChange={(group) => onChange({ group })}
            />
          </RailPart>
        ) : null}

        {/* Everything here reads an account's own Letterboxd link, so a guest
            gets no section at all rather than switches that cannot turn on. */}
        {screeningsOnly || !isSignedIn ? null : (
          <RailPart>
            <RailPartLabel>Letterboxd</RailPartLabel>
            {hasLetterboxd ? null : <LetterboxdLink />}
            <RailSwitchRow
              label="Only films on my watchlist"
              disabled={!hasLetterboxd}
              isOn={params.watchlist === "only"}
              onToggle={() =>
                onChange({
                  watchlist: params.watchlist === "only" ? "any" : "only",
                })
              }
            />
            <RailSwitchRow
              label="Hide films I've already seen"
              disabled={!hasLetterboxd}
              isOn={params.watched === "hide"}
              onToggle={() =>
                onChange({
                  watched: params.watched === "hide" ? "any" : "hide",
                })
              }
            />
          </RailPart>
        )}

        <RailPart>
          <Flex
            align="center"
            justify="space-between"
            gap="8px"
            minH="18px"
            mb="4px"
          >
            <RailPartLabel>Language</RailPartLabel>
            <MakeDefault
              isDefault={remembered.isDefault}
              onMakeDefault={remembered.makeDefault}
              title={
                isEnglishOnly
                  ? "Keep English-only on every time you open the feed, on this device"
                  : "Open the feed with every language every time, on this device"
              }
            />
          </Flex>
          <RailSwitchRow
            label="English subtitled (or spoken) only"
            isOn={isEnglishOnly}
            onToggle={() =>
              onChange({ languages: isEnglishOnly ? [] : [ENGLISH] })
            }
          />
        </RailPart>

        <RailSection
          title="When"
          summary="Any day, any time"
          chips={whenChips}
          defaultOpen={false}
        >
          <Stack gap="10px">
            <Box>
              <RailFacetHeading
                action={
                  params.days.length ? (
                    <RailTextButton onClick={() => onChange({ days: [] })}>
                      Clear
                    </RailTextButton>
                  ) : undefined
                }
              >
                Days
              </RailFacetHeading>
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
                      title={option.label}
                      isOn={params.days.includes(option.token)}
                      onToggle={() => toggleDay(option.token)}
                    />
                  ))}
                </RailPillRow>
                {isoDays.length ? (
                  <RailPillRow>
                    {isoDays.map((day) => (
                      <RailPill
                        key={day}
                        label={getDaySelectionLabel(day)}
                        title={`Remove ${getDaySelectionLabel(day)}`}
                        isOn
                        onToggle={() => toggleDay(day)}
                      />
                    ))}
                  </RailPillRow>
                ) : null}
                <Flex gap="6px" align="center">
                  <RailInput
                    type="date"
                    label="Add a specific date"
                    value={dateDraft}
                    onChange={setDateDraft}
                  />
                  <RailTextButton
                    title="Add this date to the filter"
                    onClick={() => {
                      if (!dateDraft || params.days.includes(dateDraft)) return
                      onChange({ days: [...params.days, dateDraft] })
                      setDateDraft("")
                    }}
                  >
                    Add date
                  </RailTextButton>
                </Flex>
              </Stack>
            </Box>

            <Box>
              <RailFacetHeading
                action={
                  params.times.length ? (
                    <RailTextButton onClick={() => onChange({ times: [] })}>
                      Clear
                    </RailTextButton>
                  ) : undefined
                }
              >
                Time of day
              </RailFacetHeading>
              <RangeSlider
                scale={TIME_SCALE}
                value={params.times}
                onChange={(times) => onChange({ times })}
                label="Time of day"
              />
            </Box>
          </Stack>
        </RailSection>

        {/* With the film-level filters gone this is only friends, which a
            guest does not have. */}
        {screeningsOnly && !isSignedIn ? null : (
          <RailSection
            title="More filters"
            summary={screeningsOnly ? "Friends" : "Friends, length, lists"}
            chips={moreChips}
            defaultOpen={false}
          >
            <Stack gap="12px">
              {/* A guest has no friends, so this could only ever narrow the feed
                to nothing — hidden rather than gated, the same call the app
                makes. */}
              {isSignedIn ? (
                <Box>
                  <RailFacetHeading
                    action={
                      friendStatusOn ? (
                        <RailTextButton
                          onClick={() =>
                            onChange({ status: "all", mine: false })
                          }
                        >
                          Clear
                        </RailTextButton>
                      ) : undefined
                    }
                  >
                    {params.mine ? "Marked by you" : "Marked by friends"}
                  </RailFacetHeading>
                  <RailSegmented
                    label={params.mine ? "Marked by you" : "Marked by friends"}
                    options={FRIEND_STATUS_OPTIONS}
                    // "Only mine" on its own already means everything you
                    // marked, which is what "Interested" shows.
                    value={
                      params.mine && params.status === "all"
                        ? "interested"
                        : params.status
                    }
                    // "Any" with only your own marks would still be your agenda,
                    // so it lets go of both.
                    onChange={(status) =>
                      onChange(
                        status === "all" ? { status, mine: false } : { status },
                      )
                    }
                  />
                  {/* Your agenda, as a filter rather than a page of its own. */}
                  <RailSwitchRow
                    label="Only my own plans"
                    isOn={params.mine}
                    onToggle={() =>
                      onChange(
                        params.mine
                          ? { mine: false }
                          : {
                              mine: true,
                              // Your plans and a friend's are two answers to
                              // "whose"; the newest one wins.
                              friends: [],
                              status:
                                params.status === "all"
                                  ? "interested"
                                  : params.status,
                            },
                      )
                    }
                  />
                </Box>
              ) : null}

              {isSignedIn ? (
                <FriendFilter
                  selected={params.friends}
                  onChange={(friends) =>
                    onChange(
                      friends.length ? { friends, mine: false } : { friends },
                    )
                  }
                />
              ) : null}

              {lists.length && !screeningsOnly ? (
                <Box>
                  <RailFacetHeading
                    action={
                      listsOn ? (
                        <RailTextButton
                          onClick={() =>
                            onChange({ lists: [], excludeLists: [] })
                          }
                        >
                          Clear
                        </RailTextButton>
                      ) : undefined
                    }
                  >
                    Letterboxd lists
                  </RailFacetHeading>
                  <Stack gap="8px">
                    {lists.map((list) => {
                      const isOnly = params.lists.includes(list.id)
                      const isHidden = params.excludeLists.includes(list.id)
                      const setListMode = (mode: "off" | "only" | "hide") =>
                        onChange({
                          lists:
                            mode === "only"
                              ? [...new Set([...params.lists, list.id])]
                              : params.lists.filter(
                                  (entry) => entry !== list.id,
                                ),
                          excludeLists:
                            mode === "hide"
                              ? [...new Set([...params.excludeLists, list.id])]
                              : params.excludeLists.filter(
                                  (entry) => entry !== list.id,
                                ),
                        })
                      return (
                        <RailModeRow
                          key={list.id}
                          name={list.title ?? list.list_slug}
                          isOnly={isOnly}
                          isHidden={isHidden}
                          onOnly={() => setListMode(isOnly ? "off" : "only")}
                          onHide={() => setListMode(isHidden ? "off" : "hide")}
                        />
                      )
                    })}
                  </Stack>
                </Box>
              ) : null}

              {screeningsOnly ? null : (
                <Box>
                  <RailFacetHeading
                    action={
                      runtimeOn ? (
                        <RailTextButton
                          onClick={() => onChange({ runtime: [] })}
                        >
                          Clear
                        </RailTextButton>
                      ) : undefined
                    }
                  >
                    Film length
                  </RailFacetHeading>
                  <RangeSlider
                    scale={RUNTIME_SCALE}
                    value={params.runtime}
                    onChange={(runtime) => onChange({ runtime })}
                    label="Film length"
                  />
                </Box>
              )}
            </Stack>
          </RailSection>
        )}

        {onReset ? (
          <ClearFiltersButton
            count={displayedFilterCount}
            hasSearch={Boolean(params.q)}
            onClear={clearFilters}
          />
        ) : null}
      </Box>

      {isCinemaSheetOpen || leavingIds !== null ? (
        <CinemaSheet
          anchorRef={cardRef}
          cinemas={cinemas ?? []}
          draftIds={draftIds ?? leavingIds ?? []}
          isLeaving={!isCinemaSheetOpen}
          setDraftIds={setDraftIds}
          isSignedIn={isSignedIn}
          presetState={presetState}
          onSavePreferred={preferredSave.save}
          onPromotePreset={preferredSave.promote}
          onApply={applyCinemas}
        />
      ) : null}
      {preferredSave.prompt}
    </Box>
  )
})

export default FeedFilterRail
