/**
 * Mobile filter UI component: Active Filter Chips.
 * A scrollable row of chips for every currently-active filter dimension.
 * Regular chips have an × that removes only that filter.
 * The cinema chip is always present, has no ×, and opens a preset dropdown.
 *
 * Chips keep the order they arrived in — see `orderedChips` — so applying a
 * preset never reshuffles the ones that were already there.
 *
 * The row is also the conductor for its own motion. It is the only thing that
 * can see both halves of a change — what a preset dropped and what it added —
 * so it decides when each of the two beats begins. What it never does is
 * *drive* an animation, or even own one: every decision here is made in the
 * commit the change lands in and handed to a chip as two booleans it reads at
 * mount, because the JS thread is busy re-rendering the feed and anything the
 * row still had to say afterwards would arrive too late to be part of the
 * movement. See `filter-change-animation` for the beats themselves. (The
 * preset button is not part of this: it answers its own tap in the frame it is
 * tapped.)
 *
 * The same principle runs the other way for a removal: the row takes a tapped
 * chip out of its own list first and writes the filter a frame later, so the
 * exit starts in a commit that rebuilds nothing. See `dismiss`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { Language } from "shared/client";
import { useFetchLetterboxdLists } from "shared/hooks/useLetterboxdLists";

import { useThemeColors } from "@/hooks/use-theme-color";
import { getDaySelectionLabel } from "@/components/filters/day-filter-utils";
import { getPresetForRange } from "@/components/filters/time-filter-presets";
import { formatTimeRangeChipLabel, formatRuntimeRangeChipLabel } from "@/components/filters/time-range-utils";
import { type SharedTabShowtimeFilter } from "@/components/filters/shared-tab-filters";
import CinemaFilterChip from "@/components/filters/CinemaFilterChip";
import ActiveFilterChip from "@/components/filters/ActiveFilterChip";
import { PHASE_ONE_MS } from "@/components/filters/filter-change-animation";
import { usePresetApply } from "@/components/filters/preset-apply-signal";
import { isListDimension, type PresetDimension } from "@/components/filters/saved-presets";
import type { OpenCinemaModalOptions } from "@/components/filters/CinemaFilterModal";
import { triggerImpactHaptic } from "@/utils/long-press";

type ActiveFilterChipsProps = {
  groupByMovie: boolean;
  setGroupByMovie: (v: boolean) => void;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
  watchlistExclude?: boolean;
  setWatchlistExclude?: (v: boolean) => void;
  hideWatched: boolean;
  setHideWatched: (v: boolean) => void;
  watchedOnly?: boolean;
  setWatchedOnly?: (v: boolean) => void;
  canUseWatchlistFilter?: boolean;
  selectedShowtimeFilter: SharedTabShowtimeFilter;
  setSelectedShowtimeFilter: (v: SharedTabShowtimeFilter) => void;
  showStatusFilter?: boolean;
  /**
   * An agenda's "interested as well as going" switch. Included is the default,
   * so the chip stands for the narrowed state — see the chip's ⊘ below — and
   * removing it puts the interested showtimes back.
   */
  includeInterested?: boolean;
  setIncludeInterested?: (v: boolean) => void;
  showInterestedFilter?: boolean;
  selectedDays: string[];
  setSelectedDays: (v: string[]) => void;
  selectedTimeRanges: string[];
  setSelectedTimeRanges: (v: string[]) => void;
  selectedRuntimeRanges: string[];
  setSelectedRuntimeRanges: (v: string[]) => void;
  selectedListIds?: string[];
  setSelectedListIds?: (v: string[]) => void;
  excludeListIds?: string[];
  setExcludeListIds?: (v: string[]) => void;
  selectedLanguages?: Language[];
  setSelectedLanguages?: (v: Language[]) => void;
  /** When provided, the cinema chip is always rendered and opens the filters modal. */
  onOpenFilters?: () => void;
  /** Optional override for the cinema chip's "select cinemas" action (used outside the tab provider). */
  onOpenCinemaModal?: (options?: OpenCinemaModalOptions) => void;
  /** True while searching by cinema name — see CinemaFilterChip's `disabled`. */
  cinemaFilterDisabled?: boolean;
  onClearAll?: () => void;
  /** Render inline (no bottom border, no background) with a leading vertical divider. */
  inline?: boolean;
};

type Chip = {
  key: string;
  label: string;
  /** See `ActiveFilterChip`: the ⊘ that saves the word "Hide". */
  icon?: keyof typeof MaterialIcons.glyphMap;
  /** Spelled out for screen readers wherever the icon carries meaning. */
  accessibilityLabel?: string;
  onRemove: () => void;
};

/**
 * The one icon the chips use, on every filter that excludes rather than
 * includes. One glyph for all of them so it reads as a modifier — "not this" —
 * rather than as a decoration on a particular chip.
 */
const EXCLUDE_ICON = "block" as const;

/**
 * Which chips each preset dimension owns.
 *
 * `cinemas` is deliberately absent: the cinema pill is not one of these chips
 * and answers a preset in its own way, by resizing and morphing its label.
 */
const CHIP_KEYS_BY_DIMENSION: Partial<Record<PresetDimension, readonly string[]>> = {
  selected_showtime_filter: ["status"],
  watchlist_only: ["watchlist", "watchlist-exclude"],
  hide_watched: ["hide-watched", "watched-only"],
  days: ["days"],
  time_ranges: ["times"],
  runtime_ranges: ["runtimes"],
  group_by_movie: ["group-by-movie"],
  selected_languages: ["languages"],
};

/** Both list chips answer to any of the per-list dimensions. */
const LIST_CHIP_KEYS = ["lists-include", "lists-exclude"] as const;

const chipKeysForDimensions = (dimensions: readonly PresetDimension[]): Set<string> => {
  const keys = new Set<string>();
  for (const dimension of dimensions) {
    if (isListDimension(dimension)) {
      for (const key of LIST_CHIP_KEYS) keys.add(key);
      continue;
    }
    for (const key of CHIP_KEYS_BY_DIMENSION[dimension] ?? []) keys.add(key);
  }
  return keys;
};

/**
 * One chip per filter, not per value.
 *
 * Picking four days used to put four chips in the row, which is four borders,
 * four ×s and four gaps to say one thing — and it pushed every other filter
 * off the right-hand edge, where the whole point of the row is that the user
 * can see what is on. So a filter with several values names the first and
 * counts the rest: "Fri 5 Sep +3".
 *
 * The × then clears that filter rather than that value. It is what the chip
 * says it is, and the Filters modal is where a single value comes back off.
 */
const summarizeValues = (labels: readonly string[]): string =>
  labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : (labels[0] ?? "");

const STATUS_LABEL: Record<SharedTabShowtimeFilter, string | null> = {
  all: null,
  interested: "Interested",
  going: "Going",
};



/**
 * How long after an apply a chip arriving in the row still counts as the
 * preset's doing, and so arrives wearing the flash.
 *
 * Most of a preset lands in one commit, but four of the setters defer their
 * write by a frame (see `useSharedTabFilters`) and a slow phone can spread the
 * rest over a few more. A window rather than a diff against the pre-apply
 * state: what a chip needs to know is only whether a preset is what put it
 * there, and it needs to know it in the commit it mounts in.
 */
const APPLY_WATCH_MS = 400;

/**
 * How long the row will hold a chip out of the list on its own authority.
 *
 * A tap takes the chip out before the filter it stands for is written, so the
 * exit starts in a cheap commit rather than behind the feed rebuild the write
 * causes. Normally the write lands a frame later and the chip is gone for
 * real long before this. If it somehow does not, the chip comes back — a
 * filter that is still on with nothing in the row to say so is worse than a
 * removal that visibly did not take.
 */
const DISMISS_FALLBACK_MS = 600;

/**
 * The row's own gap, needed in JS to work out what a removed chip took up.
 * Deliberately narrow: the chips are already outlined, so the gap only has to
 * separate them, and every point of it is a point of some other chip nobody
 * gets to see.
 */
const CHIP_GAP = 6;

/**
 * How long the row holds the space a removed chip left before giving it back.
 * Long enough to cover the chip's exit and the scroll that follows it; giving
 * it back early is the jump this exists to prevent, giving it back late only
 * leaves a moment of empty space off the right-hand edge.
 */
const SCROLL_SETTLE_MS = 420;

const EMPTY_LIST_IDS: string[] = [];
const EMPTY_LANGUAGES: Language[] = [];

const RUNTIME_LABEL: Record<string, string> = {
  "0-90": "<90m",
  "90-120": "90-120m",
  "120-999": ">120m",
};

const LANGUAGE_LABEL: Record<Language, string> = { nl: "Dutch", en: "English" };

export default function ActiveFilterChips({
  groupByMovie,
  setGroupByMovie,
  watchlistOnly,
  setWatchlistOnly,
  watchlistExclude = false,
  setWatchlistExclude = () => {},
  hideWatched,
  setHideWatched,
  watchedOnly = false,
  setWatchedOnly = () => {},
  canUseWatchlistFilter = false,
  selectedShowtimeFilter,
  setSelectedShowtimeFilter,
  showStatusFilter = false,
  includeInterested = true,
  setIncludeInterested = () => {},
  showInterestedFilter = false,
  selectedDays,
  setSelectedDays,
  selectedTimeRanges,
  setSelectedTimeRanges,
  selectedRuntimeRanges,
  setSelectedRuntimeRanges,
  selectedListIds = EMPTY_LIST_IDS,
  setSelectedListIds = () => {},
  excludeListIds = EMPTY_LIST_IDS,
  setExcludeListIds = () => {},
  selectedLanguages = EMPTY_LANGUAGES,
  setSelectedLanguages = () => {},
  onOpenFilters,
  onOpenCinemaModal,
  cinemaFilterDisabled = false,
  onClearAll,
  inline = false,
}: ActiveFilterChipsProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const contentW = useRef(0);
  const containerW = useRef(0);
  const scrollX = useRef(0);
  /** Every chip's last laid-out width, kept so a removed one can be replaced. */
  const chipWidths = useRef(new Map<string, number>());
  /**
   * Set when chips arrive, cleared by the scroll that shows them.
   *
   * A new chip goes on the end of the row (see `orderedChips`), which on a row
   * that already overflows is off the right-hand edge — so a preset applied
   * from a full row changed nothing the user could see. The scroll is what
   * connects the tap to its result.
   */
  const revealPendingRef = useRef(false);
  const { data: letterboxdLists = [] } = useFetchLetterboxdLists(
    selectedListIds.length > 0 || excludeListIds.length > 0
  );
  const listTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const list of letterboxdLists) map.set(list.id, list.title ?? list.list_slug);
    return map;
  }, [letterboxdLists]);

  const chips = useMemo<Chip[]>(() => {
    const result: Chip[] = [];

    if (groupByMovie) {
      result.push({
        key: "group-by-movie",
        // Not "Grouped by movie": the row it sits in is a row of things done
        // to the movie list, so what it is grouped by is not in question.
        label: "Grouped",
        accessibilityLabel: "Grouped by movie",
        onRemove: () => setGroupByMovie(false),
      });
    }

    if (showStatusFilter && selectedShowtimeFilter !== "all") {
      const label = STATUS_LABEL[selectedShowtimeFilter];
      if (label) {
        result.push({
          key: "status",
          label,
          onRemove: () => setSelectedShowtimeFilter("all"),
        });
      }
    }

    // Same shape as the other excluding filters: the word for what is being
    // left out, with the ⊘ in front. "Going only" would be a second way of
    // saying it, in a row where every other chip names the thing it drops.
    if (showInterestedFilter && !includeInterested) {
      result.push({
        key: "interested-exclude",
        label: "Interested",
        icon: EXCLUDE_ICON,
        accessibilityLabel: "Hide interested",
        onRemove: () => setIncludeInterested(true),
      });
    }

    if (canUseWatchlistFilter && watchlistOnly) {
      result.push({
        key: "watchlist",
        label: "Watchlist",
        onRemove: () => setWatchlistOnly(false),
      });
    }

    // The excluding filters are the same word as their including twin with the
    // ⊘ in front — "Watchlist" and "not Watchlist" — which is both shorter and
    // easier to tell apart at a glance than two sentences that start alike.
    if (canUseWatchlistFilter && watchlistExclude) {
      result.push({
        key: "watchlist-exclude",
        label: "Watchlist",
        icon: EXCLUDE_ICON,
        accessibilityLabel: "Hide watchlist",
        onRemove: () => setWatchlistExclude(false),
      });
    }

    if (canUseWatchlistFilter && hideWatched) {
      result.push({
        key: "hide-watched",
        label: "Watched",
        icon: EXCLUDE_ICON,
        accessibilityLabel: "Hide watched",
        onRemove: () => setHideWatched(false),
      });
    }

    if (canUseWatchlistFilter && watchedOnly) {
      result.push({
        key: "watched-only",
        label: "Watched",
        onRemove: () => setWatchedOnly(false),
      });
    }

    if (selectedListIds.length > 0) {
      const titles = selectedListIds.map((listId) => listTitleById.get(listId) ?? "List");
      result.push({
        key: "lists-include",
        label: summarizeValues(titles),
        accessibilityLabel: `Lists: ${titles.join(", ")}`,
        onRemove: () => setSelectedListIds([]),
      });
    }

    if (excludeListIds.length > 0) {
      const titles = excludeListIds.map((listId) => listTitleById.get(listId) ?? "List");
      result.push({
        key: "lists-exclude",
        label: summarizeValues(titles),
        icon: EXCLUDE_ICON,
        accessibilityLabel: `Hide lists: ${titles.join(", ")}`,
        onRemove: () => setExcludeListIds([]),
      });
    }

    if (selectedDays.length > 0) {
      const labels = selectedDays.map(getDaySelectionLabel);
      result.push({
        key: "days",
        label: summarizeValues(labels),
        accessibilityLabel: `Days: ${labels.join(", ")}`,
        onRemove: () => setSelectedDays([]),
      });
    }

    if (selectedTimeRanges.length > 0) {
      const labels = selectedTimeRanges.map((range) => {
        const preset = getPresetForRange(range);
        return preset ? preset.label : formatTimeRangeChipLabel(range);
      });
      result.push({
        key: "times",
        label: summarizeValues(labels),
        accessibilityLabel: `Times: ${labels.join(", ")}`,
        onRemove: () => setSelectedTimeRanges([]),
      });
    }

    if (selectedRuntimeRanges.length > 0) {
      const labels = selectedRuntimeRanges.map(
        (range) => RUNTIME_LABEL[range] ?? formatRuntimeRangeChipLabel(range)
      );
      result.push({
        key: "runtimes",
        label: summarizeValues(labels),
        accessibilityLabel: `Runtimes: ${labels.join(", ")}`,
        onRemove: () => setSelectedRuntimeRanges([]),
      });
    }

    if (selectedLanguages.length > 0) {
      const labels = selectedLanguages.map((language) => LANGUAGE_LABEL[language]);
      result.push({
        key: "languages",
        label: summarizeValues(labels),
        accessibilityLabel: `Languages: ${labels.join(", ")}`,
        onRemove: () => setSelectedLanguages([]),
      });
    }

    return result;
  }, [
    groupByMovie,
    watchlistOnly,
    watchlistExclude,
    hideWatched,
    watchedOnly,
    canUseWatchlistFilter,
    selectedShowtimeFilter,
    showStatusFilter,
    includeInterested,
    showInterestedFilter,
    selectedListIds,
    excludeListIds,
    listTitleById,
    selectedDays,
    selectedTimeRanges,
    selectedRuntimeRanges,
    selectedLanguages,
    setGroupByMovie,
    setWatchlistOnly,
    setWatchlistExclude,
    setHideWatched,
    setWatchedOnly,
    setSelectedShowtimeFilter,
    setIncludeInterested,
    setSelectedListIds,
    setExcludeListIds,
    setSelectedDays,
    setSelectedTimeRanges,
    setSelectedRuntimeRanges,
    setSelectedLanguages,
  ]);

  // ─── The two beats ───────────────────────────────────────────────────────
  // The row answers a change in two, never at once (see
  // `filter-change-animation`):
  //
  //   1. Everything that goes, goes, and the cinema pill changes with it. The
  //      row closes over the gap on the same clock.
  //   2. Only then: everything that arrives, arrives, with the flash.
  //
  // Every one of which is set up in a single commit, at the moment of the
  // change, and then plays out on the UI thread. Nothing is scheduled onto the
  // JS thread: applying a preset also empties and re-renders the feed below,
  // which can hold JS for hundreds of milliseconds, and a boundary that waits
  // on a `setTimeout` waits on that too — while the pill it is supposed to be
  // following keeps perfect time on the UI thread.
  //
  // So an arriving chip is mounted at once, laid out at the end of the row
  // where it moves nothing, and simply held at zero opacity until beat one is
  // over (`chipEnteringAfterBeatOne`). A chip that is invisible cannot be seen
  // to be in the wrong place, and by the time it is visible the row it is in
  // has stopped moving.
  //
  // Only a preset apply is animated as an event: the user removing a chip by
  // hand already knows which one they tapped, and flashing it would flag their
  // own edit back at them.
  const presetApply = usePresetApply();

  // ─── What a preset re-asserts ────────────────────────────────────────────
  // A preset writing a dimension is making a claim about it, and the row shows
  // the claim rather than the difference: the chip goes in beat one and comes
  // back in beat two, whether or not its value moved. A preset that sets a
  // filter to what it already was is otherwise indistinguishable from one that
  // skipped the filter entirely, and telling those two apart is the whole
  // point of a partial preset.
  const orderRef = useRef<string[]>([]);
  /** Bumped when the order is rewritten under a memo that cannot see it. */
  const [orderGeneration, setOrderGeneration] = useState(0);
  /** Keys this apply re-asserted, so the flash below can mark them. */
  const reassertedRef = useRef<ReadonlySet<string>>(new Set());
  /**
   * Bumped per key on every re-assert, and part of the chip's React key. One
   * commit then unmounts the old copy — which Reanimated takes out of the
   * layout and plays out where it stood — and mounts a new one on the end of
   * the row, waiting for beat one. Going and coming back is one commit, not
   * two, which is what keeps it off the JS thread's schedule.
   */
  const [replayNonces, setReplayNonces] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );
  const applySeenRef = useRef(presetApply.count);
  /**
   * The pill's flash, which runs on a clock of its own and starts at once — so
   * all it needs from here is to be told, and a counter is how you tell
   * something twice. Bumped for the cinemas being *written*: unlike the beat
   * below, a preset pinning the cinemas you are already on is still the preset
   * saying "these ones", and that is what the flash is for.
   */
  const [cinemaFlashNonce, setCinemaFlashNonce] = useState(0);
  if (presetApply.count !== applySeenRef.current) {
    applySeenRef.current = presetApply.count;
    if (presetApply.dimensions.includes("cinemas")) {
      setCinemaFlashNonce((nonce) => nonce + 1);
    }
    const written = chipKeysForDimensions(presetApply.dimensions);
    const reasserted = orderRef.current.filter((key) => written.has(key));
    reassertedRef.current = new Set(reasserted);
    if (reasserted.length > 0) {
      // Out of the order, so `orderedChips` puts them back on the *end*. Beat
      // two may only ever append: a chip coming back in the middle would shove
      // everything after it sideways while it was fading in, which is the one
      // thing the two beats exist to prevent. It also happens to be true — a
      // filter the preset just set is one of the newest things in the row.
      orderRef.current = orderRef.current.filter((key) => !written.has(key));
      setOrderGeneration((generation) => generation + 1);
      setReplayNonces((current) => {
        const next = new Map(current);
        for (const key of reasserted) next.set(key, (next.get(key) ?? 0) + 1);
        return next;
      });
    }
  }

  // ─── Taking a chip out before its filter is ─────────────────────────────
  // Removing a filter re-renders the feed, and for most dimensions it does so
  // in the tap's own commit — the session cache is written synchronously, the
  // query key changes, and the list rebuilds. The chip's exit cannot start
  // until that commit is done, which on a phone is long enough to read as the
  // row ignoring the tap. (Status and watchlist looked instant only because
  // their setters already defer the query-facing write by a frame.)
  //
  // So the row stops drawing the chip on its own authority, and writes the
  // filter on the next frame. The exit plays out of a commit that touches
  // nothing but these chips, and the feed rebuilds underneath it while it is
  // already running on the UI thread.
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const visibleChips = useMemo(
    () =>
      dismissedKeys.size === 0
        ? chips
        : chips.filter((chip) => !dismissedKeys.has(chip.key)),
    [chips, dismissedKeys]
  );

  const dismiss = (chip: Chip) => {
    setDismissedKeys((current) => new Set(current).add(chip.key));
    requestAnimationFrame(chip.onRemove);
  };

  useEffect(() => {
    if (dismissedKeys.size === 0) return;
    const present = new Set(chips.map((chip) => chip.key));
    const pending = [...dismissedKeys].filter((key) => present.has(key));
    if (pending.length !== dismissedKeys.size) {
      // At least one write has landed; the row no longer has to pretend.
      setDismissedKeys(new Set(pending));
      return;
    }
    const timer = setTimeout(() => setDismissedKeys(new Set()), DISMISS_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [chips, dismissedKeys]);

  // ─── The order the chips are actually drawn in ───────────────────────────
  // The list above is built in a fixed order, which is only a convenient way
  // to enumerate the filters — it is not an order the row owes anyone. Drawing
  // it literally means a preset that switches two filters on has its chips
  // slot into their places among the ones already there, shoving the rest
  // sideways; apply two presets in a row and the whole row shuffles.
  //
  // So the row keeps the order it has and puts arrivals on the end. Nothing a
  // chip does moves any chip that was already there.
  const orderedChips = useMemo<Chip[]>(() => {
    const byKey = new Map(visibleChips.map((chip) => [chip.key, chip]));
    // Written during the render that uses it, so the order is right on the
    // first pass rather than one pass late. Safe to run twice: a second call
    // with the same chips finds every key already placed and appends nothing.
    const kept = orderRef.current.filter((key) => byKey.has(key));
    const placed = new Set(kept);
    const arrived = visibleChips
      .filter((chip) => !placed.has(chip.key))
      .map((chip) => chip.key);
    orderRef.current = [...kept, ...arrived];
    return orderRef.current.map((key) => byKey.get(key)!);
    // `orderGeneration` is the dependency, not a value: a preset can re-assert
    // a filter without changing any of them, which leaves `chips` identical
    // and this memo holding the order the re-assert just rewrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleChips, orderGeneration]);

  const labelByKey = useMemo(
    () => new Map(orderedChips.map((chip) => [chip.key, chip.label])),
    [orderedChips]
  );

  // ─── What changed since the last pass ────────────────────────────────────
  // Chips whose filter is gone. A re-asserted chip is not one of them: its old
  // copy unmounts in the same commit its new copy mounts, so the row's width
  // is unchanged and there is nothing for the scroll to be held still for.
  const previousKeysRef = useRef<string[]>([...labelByKey.keys()]);
  const goneKeys = previousKeysRef.current.filter((key) => !labelByKey.has(key));
  const arrivedKeys = [...labelByKey.keys()].filter(
    (key) => !previousKeysRef.current.includes(key)
  );
  previousKeysRef.current = [...labelByKey.keys()];

  /**
   * When beat one ends. A timestamp rather than a flag because it is read, not
   * waited on: the entering chips and the flash both take a *delay* from it and
   * then run on the UI thread, where nothing the JS thread is doing can hold
   * them up.
   *
   * Never brought forward. A second change landing while the first beat is
   * still running joins it rather than restarting the row underneath itself.
   */
  const phaseOneEndsAt = useRef(0);
  const startBeatOne = () => {
    phaseOneEndsAt.current = Math.max(phaseOneEndsAt.current, Date.now() + PHASE_ONE_MS);
  };

  // Anything leaving is a beat one, preset or not: a chip removed by hand
  // still needs the row to close over its gap before anything may arrive. A
  // re-assert counts too — its old copy plays the same exit, and the row
  // closes over that gap on the way to putting the chip back on the end.
  const leavingSig = [...goneKeys, ...reassertedRef.current].join("|");
  const beatFor = useRef("");
  if (!leavingSig) {
    beatFor.current = "";
  } else if (leavingSig !== beatFor.current) {
    beatFor.current = leavingSig;
    startBeatOne();
  }

  // The pill is the one thing left that can need a beat of its own, since it
  // is not one of these chips and answers by resizing. `cinemasChanged` rather
  // than "wrote the cinemas": a preset that pins the cinemas you are already
  // on resizes nothing, and a beat spent waiting for a pill that is not going
  // to move is a beat of the row sitting still for no reason.
  //
  // So a preset that takes nothing away schedules no beat at all: its chips
  // arrive at once and the flash goes with them.
  //
  // Decided during this render rather than from an effect, because this is
  // where the beat is decided.
  //
  // The window, not a set of keys: a chip carries its own flash in its
  // entrance (see `useChipEntering`), so all the row has to answer is whether
  // a chip mounting *now* is one a preset put there. Marking them individually
  // meant a `setState` and therefore a second commit, and the chip had already
  // finished growing by the time that commit told it to start colouring.
  const applyWindowEndsAt = useRef(0);
  const flashStartedFor = useRef(presetApply.count);
  if (presetApply.count !== flashStartedFor.current) {
    flashStartedFor.current = presetApply.count;
    if (presetApply.cinemasChanged) startBeatOne();
    applyWindowEndsAt.current = Date.now() + APPLY_WATCH_MS;
  }
  const withinApplyWindow = applyWindowEndsAt.current > Date.now();

  // Whether a chip mounting right now has to wait. Read only at mount, and
  // true for the whole of the beat rather than only on the pass that started
  // it: four of the filter setters defer their write by a frame (see
  // `useSharedTabFilters`), so some of a preset's chips mount a commit later
  // than the rest and have exactly the same beat to wait out.
  const beatOneRunning = phaseOneEndsAt.current > Date.now();

  if (arrivedKeys.length > 0) {
    // Arrivals only. A removal moves the row the other way, and that scroll is
    // the reserved space's to make.
    revealPendingRef.current = true;
  }

  // ─── Holding the scroll still while a chip leaves ────────────────────────
  // The chips sit in a horizontal scroller. Removing one makes the content
  // narrower, and a scroller whose content no longer reaches its offset clamps
  // to the new end instantly — so a row scrolled to the right snapped left the
  // moment a chip went, which no animation can smooth over because the jump is
  // the scroll position, not the chips.
  //
  // Instead the row keeps the width: an empty spacer takes over exactly what
  // the leaving chip occupied, so nothing clamps, and the scroll walks to its
  // new resting place under its own animation. The spacer is handed back once
  // it has arrived, by which point there is nothing left for it to hold.
  const [reservedWidth, setReservedWidth] = useState(0);
  // What the current reservation is for, so a removal is only paid for once.
  const reservedFor = useRef("");
  const goneSig = goneKeys.join("|");
  if (!goneSig) {
    reservedFor.current = "";
  } else if (goneSig !== reservedFor.current) {
    // Set during render, so the spacer is in place in the same commit that
    // takes the chip out — a pass later and the scroller has already clamped.
    reservedFor.current = goneSig;
    const freed = goneKeys.reduce(
      (total, key) => total + (chipWidths.current.get(key) ?? 0) + CHIP_GAP,
      0
    );
    // Added to whatever is still reserved: removals can overlap, and each one
    // narrows the content again.
    if (freed > 0) setReservedWidth((current) => current + freed);
  }

  // Mirrored for the scroll handlers, which have to discount space that is
  // being held rather than filled when they decide if the row overflows.
  const reservedRef = useRef(0);
  reservedRef.current = reservedWidth;

  useEffect(() => {
    if (reservedWidth === 0) return;
    // Where the content will end once the space is handed back. `contentW` is
    // still the pre-removal width here, which is the same thing: the spacer
    // replaced exactly what was lost.
    const restingOffset = Math.max(0, contentW.current - reservedWidth - containerW.current);
    if (scrollX.current > restingOffset) {
      scrollRef.current?.scrollTo({ x: restingOffset, animated: true });
    }
    const timer = setTimeout(() => setReservedWidth(0), SCROLL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [reservedWidth]);

  // Don't render if there's nothing to show (no cinema chip and no filter chips)
  if (!onOpenFilters && orderedChips.length === 0) return null;

  return (
    <View style={inline ? styles.inlineContainer : styles.container}>
      {inline && <View style={styles.inlineLeadDivider} />}
      <View style={styles.list}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          ref={scrollRef}
          contentContainerStyle={inline ? styles.inlineContent : styles.content}
          scrollEventThrottle={16}
          onLayout={(e) => {
            containerW.current = e.nativeEvent.layout.width;
            setHasMoreRight(contentW.current > e.nativeEvent.layout.width + 2);
          }}
          onContentSizeChange={(w) => {
            contentW.current = w;
            setHasMoreRight(w - reservedRef.current > containerW.current + 2);
            // Here rather than in an effect: this is the first moment the row
            // knows how wide the chip that just arrived made it.
            if (revealPendingRef.current) {
              revealPendingRef.current = false;
              // Short of any space a simultaneous removal is still holding —
              // the newest chip is at the end of what is really there, not at
              // the end of the spacer behind it.
              const end = Math.max(0, w - reservedRef.current - containerW.current);
              // Never drags the row left: an arrival can only ever need to
              // show something further right than what is on screen.
              if (end > scrollX.current) {
                scrollRef.current?.scrollTo({ x: end, animated: true });
              }
            }
          }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            scrollX.current = contentOffset.x;
            setHasMoreRight(
              contentOffset.x + layoutMeasurement.width <
                contentSize.width - reservedRef.current - 2
            );
          }}
        >
          {onOpenFilters && (
            <CinemaFilterChip
              onOpenFilters={onOpenFilters}
              onOpenCinemaModal={onOpenCinemaModal}
              disabled={cinemaFilterDisabled}
              flashNonce={cinemaFlashNonce}
            />
          )}
          {orderedChips.map((chip) => (
            <ActiveFilterChip
              // The nonce is what makes a re-assert happen at all: same chip,
              // new identity, so one commit unmounts the old copy and mounts
              // the new one further along the row.
              key={`${chip.key}#${replayNonces.get(chip.key) ?? 0}`}
              label={chip.label}
              icon={chip.icon}
              accessibilityLabel={chip.accessibilityLabel}
              onRemove={() => dismiss(chip)}
              flashOnEnter={withinApplyWindow}
              waitForBeatOne={beatOneRunning}
              onMeasureWidth={(width) => chipWidths.current.set(chip.key, width)}
            />
          ))}
          {reservedWidth > 0 && (
            // The gap before it belongs to the chip that left, so it is taken
            // back out: the spacer stands for exactly what was removed.
            <View
              pointerEvents="none"
              style={{ width: reservedWidth, marginLeft: -CHIP_GAP }}
            />
          )}
        </ScrollView>
        {hasMoreRight && (
          <View style={styles.scrollFadeRight} pointerEvents="none">
            <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
          </View>
        )}
      </View>
      {onClearAll && orderedChips.length > 0 && (
        <>
          <View style={styles.clearSeparator} />
          <TouchableOpacity
            onPress={() => {
              // Heavier than a single chip's remove (`ActiveFilterChip`),
              // because it takes the whole row with it.
              triggerImpactHaptic();
              onClearAll();
            }}
            style={styles.clearBtn}
          >
            <MaterialIcons name="close" size={18} color={colors.tint} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    inlineContainer: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    inlineLeadDivider: {
      width: 1,
      height: 16,
      alignSelf: "center",
      marginHorizontal: 10,
      backgroundColor: colors.divider,
    },
    inlineContent: {
      paddingLeft: 0,
      paddingRight: 8,
      paddingVertical: 7,
      gap: CHIP_GAP,
      alignItems: "center",
    },
    list: {
      flex: 1,
      position: "relative",
    },
    scrollFadeRight: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      justifyContent: "center",
      paddingLeft: 4,
      backgroundColor: colors.background,
    },
    content: {
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 7,
      gap: CHIP_GAP,
      alignItems: "center",
    },
    clearSeparator: {
      width: 1,
      height: 20,
      backgroundColor: colors.divider,
    },
    clearBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
  });
