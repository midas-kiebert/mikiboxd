/**
 * Mobile filter UI component: Active Filter Chips.
 * A scrollable row of chips for every currently-active filter dimension.
 * Regular chips have an × that removes only that filter.
 * The cinema chip is always present, has no ×, and opens a preset dropdown.
 *
 * Chips keep the order they arrived in — see `orderedChips` — so applying a
 * preset never reshuffles the ones that were already there.
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
import {
  CHANGE_HIGHLIGHT_MS,
  CHIP_EXIT_MS,
} from "@/components/filters/filter-change-animation";
import { usePresetApply } from "@/components/filters/preset-apply-signal";
import { isListDimension, type PresetDimension } from "@/components/filters/saved-presets";
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
  onOpenCinemaModal?: () => void;
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

/**
 * Stands for the cinema pill in `addedKeys`. Not a chip key — the pill is not
 * one of `chips` — but the tint is the row's to decide and this is where the
 * row keeps that decision, along with the timer that takes it back.
 */
const CINEMA_PILL_KEY = "cinema-pill";

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
 * How long after an apply the row keeps diffing against the state the preset
 * replaced. Every setter a preset calls is synchronous, so the whole change
 * normally arrives in one commit — but a filter that reaches this row a commit
 * or two later still gets animated instead of silently appearing.
 */
const APPLY_WATCH_MS = 400;

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

  // ─── The order the chips are actually drawn in ───────────────────────────
  // The list above is built in a fixed order, which is only a convenient way
  // to enumerate the filters — it is not an order the row owes anyone. Drawing
  // it literally means a preset that switches two filters on has its chips
  // slot into their places among the ones already there, shoving the rest
  // sideways; apply two presets in a row and the whole row shuffles.
  //
  // So the row keeps the order it has and puts arrivals on the end. Nothing a
  // chip does moves any chip that was already there, and the newest chips are
  // always the ones nearest the tint that says they are new.
  const orderRef = useRef<string[]>([]);
  const orderedChips = useMemo<Chip[]>(() => {
    const byKey = new Map(chips.map((chip) => [chip.key, chip]));
    // Written during the render that uses it, so the order is right on the
    // first pass rather than one pass late. Safe to run twice: a second call
    // with the same chips finds every key already placed and appends nothing.
    const kept = orderRef.current.filter((key) => byKey.has(key));
    const placed = new Set(kept);
    const arrived = chips.filter((chip) => !placed.has(chip.key)).map((chip) => chip.key);
    orderRef.current = [...kept, ...arrived];
    return orderRef.current.map((key) => byKey.get(key)!);
  }, [chips]);

  // ─── What the last preset apply changed ──────────────────────────────────
  // Only a preset apply is animated: the user removing a chip by hand already
  // knows which one they tapped, and animating that would flag their own edit
  // back at them.
  const presetApply = usePresetApply();
  const labelByKey = useMemo(
    () => new Map(orderedChips.map((chip) => [chip.key, chip.label])),
    [orderedChips]
  );

  // Whether this pass is one where chips are leaving, which decides if the
  // rest of the row may move yet. Kept in state rather than a ref so it can be
  // read during the render that starts the animations, not a pass later.
  const [renderedKeys, setRenderedKeys] = useState<string[]>(() => [...labelByKey.keys()]);
  const removedKeys = useMemo(
    () => renderedKeys.filter((key) => !labelByKey.has(key)),
    [renderedKeys, labelByKey]
  );
  const isRemovingChip = removedKeys.length > 0;
  // Latched for the length of the exit rather than read off a single pass:
  // a chip's own resize can arrive a commit or two after the removal that
  // caused it, and it must still wait for the chips leaving to be gone.
  const [isExitRunning, setIsExitRunning] = useState(false);
  const [isReplayRunning, setIsReplayRunning] = useState(false);
  useEffect(() => {
    if (!isRemovingChip) return;
    setIsExitRunning(true);
    const timer = setTimeout(() => setIsExitRunning(false), CHIP_EXIT_MS);
    return () => clearTimeout(timer);
  }, [isRemovingChip]);
  // A chip being replayed is a chip leaving too — see `replayNonces` below.
  const hasLeavingChip = isRemovingChip || isExitRunning || isReplayRunning;
  useEffect(() => {
    const currentKeys = [...labelByKey.keys()];
    const unchanged =
      currentKeys.length === renderedKeys.length &&
      currentKeys.every((key, index) => key === renderedKeys[index]);
    if (unchanged) return;
    // Arrivals only. A removal moves the row the other way, and that scroll is
    // the reserved space's to make.
    if (currentKeys.some((key) => !renderedKeys.includes(key))) {
      revealPendingRef.current = true;
    }
    setRenderedKeys(currentKeys);
  }, [labelByKey, renderedKeys]);

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
  // What the current reservation is for, so a removal is only paid for once
  // while its keys are still missing from `renderedKeys`.
  const reservedFor = useRef("");
  const removalSig = removedKeys.join("|");
  if (!removalSig) {
    reservedFor.current = "";
  } else if (removalSig !== reservedFor.current) {
    // Set during render, so the spacer is in place in the same commit that
    // takes the chip out — a pass later and the scroller has already clamped.
    reservedFor.current = removalSig;
    const freed = removedKeys.reduce(
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

  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(() => new Set());
  // What the row looked like on the previous pass, kept so that an apply can be
  // compared against the state it replaced.
  const previousRef = useRef(labelByKey);
  const lastApplyCountRef = useRef(presetApply.count);
  /**
   * Bumped for a chip the preset wrote but did not move. The number goes into
   * the chip's React key, so the old one unmounts and plays its exit and a new
   * one mounts and plays its entrance — it closes and comes back.
   *
   * A preset that leaves a dimension alone and a preset that sets it to what
   * it already was are the same picture otherwise, and the difference is the
   * whole point of a partial preset.
   */
  const [replayNonces, setReplayNonces] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );
  /** Replayed keys, held for the watch window so their tint is not cut short. */
  const replayedKeysRef = useRef<ReadonlySet<string>>(new Set());
  /**
   * Whether the last apply wrote the cinemas. Held the same way and for the
   * same reason: the pill is tinted for writing it, not for changing it, which
   * is exactly what every other chip is tinted for.
   */
  const cinemaWrittenRef = useRef(false);
  // The pre-apply snapshot, held for as long as the row is watching for the
  // rest of the change to land.
  const baselineRef = useRef<Map<string, string> | null>(null);
  const watchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = labelByKey;

    if (presetApply.count !== lastApplyCountRef.current) {
      lastApplyCountRef.current = presetApply.count;
      baselineRef.current = previous;
      if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
      watchTimerRef.current = setTimeout(() => {
        baselineRef.current = null;
        replayedKeysRef.current = new Set();
        cinemaWrittenRef.current = false;
        watchTimerRef.current = null;
      }, APPLY_WATCH_MS);
      cinemaWrittenRef.current = presetApply.dimensions.includes("cinemas");

      // Decided here and only here. A chip the preset wrote that is already on
      // screen is on screen in this very commit — unlike an arrival, there is
      // nothing still to land, so a later pass must not replay it again.
      const written = chipKeysForDimensions(presetApply.dimensions);
      const replayed = new Set(
        [...labelByKey.keys()].filter((key) => written.has(key) && previous.has(key))
      );
      replayedKeysRef.current = replayed;
      if (replayed.size > 0) {
        setReplayNonces((current) => {
          const next = new Map(current);
          for (const key of replayed) next.set(key, (next.get(key) ?? 0) + 1);
          return next;
        });
        // Batched with the bump, so the chip that remounts sees the row
        // already holding movement back. Set a pass later and it would pick
        // the undelayed entrance and come back while it was still leaving.
        setIsReplayRunning(true);
      }
    }

    const baseline = baselineRef.current;
    if (!baseline) return;

    // Arrivals: chips that were not in the row before this apply. The cinema
    // pill is never one of them — it is always present, and answers a preset
    // by resizing and morphing its label instead.
    const arrived = new Set<string>();
    for (const key of labelByKey.keys()) {
      if (!baseline.has(key)) arrived.add(key);
    }

    // A chip the preset dropped needs no entry here: it simply stops being
    // rendered, and its own exit animation carries it off screen.

    // A replayed chip is tinted like an arrival: both are the preset saying
    // "I set this", and the entrance they play is the same one.
    const marked = new Set([...arrived, ...replayedKeysRef.current]);
    // The pill never arrives and never replays — it is always there, and
    // answers a preset by resizing and morphing its label. The tint is the one
    // part of the language it does share.
    if (cinemaWrittenRef.current) marked.add(CINEMA_PILL_KEY);

    // Same reference back when nothing about the set changed, so a quiet pass
    // inside the watch window costs no render.
    setAddedKeys((current) => {
      const same =
        marked.size === current.size && [...marked].every((key) => current.has(key));
      return same ? current : marked;
    });
  }, [presetApply, labelByKey]);

  // The replay's own leaving-chip latch, so the rest of the row waits for it
  // exactly as it waits for a real removal — and so the chip coming back waits
  // for the copy of itself that is on its way out.
  useEffect(() => {
    if (replayNonces.size === 0) return;
    const timer = setTimeout(() => setIsReplayRunning(false), CHIP_EXIT_MS);
    return () => clearTimeout(timer);
  }, [replayNonces]);

  // Highlights and ghosts clear themselves; neither is state the row can be
  // left holding if the user navigates away mid-animation.
  useEffect(() => {
    if (addedKeys.size === 0) return;
    const timer = setTimeout(() => setAddedKeys(new Set()), CHANGE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [addedKeys]);

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
              waitForExits={hasLeavingChip}
              isNew={addedKeys.has(CINEMA_PILL_KEY)}
            />
          )}
          {orderedChips.map((chip) => (
            <ActiveFilterChip
              // The nonce is what makes a replay happen at all: same chip,
              // new identity, so React unmounts one and mounts the other.
              key={`${chip.key}#${replayNonces.get(chip.key) ?? 0}`}
              label={chip.label}
              icon={chip.icon}
              accessibilityLabel={chip.accessibilityLabel}
              onRemove={chip.onRemove}
              isNew={addedKeys.has(chip.key)}
              waitForExits={hasLeavingChip}
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
