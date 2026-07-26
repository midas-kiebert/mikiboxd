/**
 * A small catalogue of ready-made filter presets, offered to users who have not
 * saved one of their own yet. They exist to show what a preset can be, so each
 * one is a combination worth having rather than a demo.
 *
 * A preset controls (clears and then sets) every filter dimension it does not
 * list as untouched. Some of these are deliberately partial: "Hide Watched"
 * should sit on top of whatever the user already has selected, not replace it.
 */
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { SavedPresetCreate } from "shared";

import {
  buildSavedPresetCreate,
  listDimension,
  CONTROLLABLE_FILTER_DIMENSIONS,
  type PresetDimension,
} from "@/components/filters/saved-presets";
import type { PageFilterPresetState } from "@/components/filters/filter-preset-utils";

/** Runtime ranges are `start-end`, either side optional. */
const UNDER_TWO_HOURS = "-120";
/** Time ranges are `start-end`; an open end runs to the 04:00 day cutoff. */
const FROM_SEVEN_PM = "19:00-";

export type PremadeFilterPreset = {
  id: string;
  name: string;
  /** One line describing what applying it does, shown in the tip. */
  summary: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  filters: PageFilterPresetState;
  /**
   * The dimensions the preset controls. Omit to control everything, which is
   * what most presets want; set it to make the preset additive.
   */
  controlledDimensions?: readonly PresetDimension[];
  /** Pins the selection to every cinema, rather than leaving cinemas alone. */
  includesAllCinemas?: boolean;
};

export const PREMADE_FILTER_PRESETS: readonly PremadeFilterPreset[] = [
  {
    id: "friends-showtimes",
    name: "Friends' showtimes",
    summary: "Marked interested by friends · Every cinema",
    icon: "groups",
    filters: { selected_showtime_filter: "interested" },
    includesAllCinemas: true,
  },
  {
    id: "watchlist",
    name: "Watchlist",
    summary: "Watchlist only · Grouped by movie",
    icon: "bookmark",
    filters: { watchlist_only: true, group_by_movie: true },
  },
  {
    id: "hide-watched",
    name: "Hide Watched",
    summary: "Hides films you have seen · Leaves your other filters alone",
    icon: "visibility-off",
    filters: { hide_watched: true },
    controlledDimensions: ["hide_watched"],
  },
  {
    id: "tomorrow-night",
    name: "Tomorrow Night",
    summary: "Tomorrow · From 19:00",
    icon: "nightlight",
    filters: { days: ["relative:tomorrow"], time_ranges: [FROM_SEVEN_PM] },
  },
  {
    id: "short",
    name: "Short",
    summary: "Under 120 minutes · Leaves your other filters alone",
    icon: "timer",
    filters: { runtime_ranges: [UNDER_TWO_HOURS] },
    controlledDimensions: ["runtime_ranges"],
  },
] as const;

type BuildArgs = {
  preset: PremadeFilterPreset;
  /** Needed by the presets that pin every cinema; ignored by the others. */
  allCinemaIds: readonly number[];
  /**
   * The user's Letterboxd lists. A partial preset has to name each one as
   * untouched, or applying it would clear list filters it never mentioned.
   */
  listIds: readonly string[];
};

export const buildPremadeSavedPreset = ({
  preset,
  allCinemaIds,
  listIds,
}: BuildArgs): SavedPresetCreate => {
  const controlled = new Set(preset.controlledDimensions ?? CONTROLLABLE_FILTER_DIMENSIONS);
  const isPartial = preset.controlledDimensions !== undefined;

  return buildSavedPresetCreate({
    name: preset.name,
    // These are suggestions, not a declaration about what should load at
    // startup, so none of them claims the single favorite slot.
    isFavorite: false,
    untouchedFields: [
      ...CONTROLLABLE_FILTER_DIMENSIONS.filter((dimension) => !controlled.has(dimension)),
      ...(isPartial ? listIds.map(listDimension) : []),
    ],
    includeCinemas: preset.includesAllCinemas === true,
    currentFilters: preset.filters,
    cinemaIds: [...allCinemaIds],
  });
};
