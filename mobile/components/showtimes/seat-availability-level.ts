/**
 * The app's presentation of a busyness level: the shared wording, plus the icon
 * and theme colour that only make sense here.
 *
 * The labels, descriptions, the seat/timestamp formatting, the icon and which
 * palette draws it all come from `shared/showtimes/seat-availability-level`, so
 * the website cannot describe — or mark — the same level differently. What is
 * left here is the part that is the app's alone: turning the palette name into
 * theme colours.
 */
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import type { SeatAvailabilityLevel } from "shared";
import {
  getSeatAvailabilityCopy,
  getSeatAvailabilityPresentation,
} from "shared/showtimes/seat-availability-level";

import type { Colors } from "@/constants/theme";

export {
  formatCheckedAt,
  formatCheckedAtShort,
  formatSeatCount,
  isUrgentSeatAvailabilityLevel,
} from "shared/showtimes/seat-availability-level";

type ThemeColors = typeof Colors.light;
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

export type SeatAvailabilityMeta = {
  level: SeatAvailabilityLevel;
  label: string;
  description: string;
  icon: MaterialIconName;
  color: string;
};

export function getSeatAvailabilityMeta(
  level: SeatAvailabilityLevel,
  colors: ThemeColors,
): SeatAvailabilityMeta | null {
  const copy = getSeatAvailabilityCopy(level);
  const presentation = getSeatAvailabilityPresentation(level);
  // A level this build no longer knows has nothing to render rather than
  // crashing on it.
  if (!copy || !presentation) return null;
  return {
    ...copy,
    icon: presentation.icon,
    color: colors[presentation.palette].secondary,
  };
}
