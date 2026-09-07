/**
 * The app's presentation of a busyness level: the shared wording, plus the icon
 * and theme colour that only make sense here.
 *
 * The labels, descriptions and the seat/timestamp formatting come from
 * `shared/showtimes/seat-availability-level`, so the website cannot describe
 * the same level differently.
 *
 * The icons are a single progression, not five unrelated marks: a lone
 * silhouette, then the room filling one more at a time, then a flame, then a
 * closed sign. Rank is in the shape as well as the colour, which is what makes
 * the badge readable at the 12px it renders at in a list row.
 *
 * The colours ramp teal → green → yellow → orange → hot red → deep red, ending
 * on two reds so the two states that actually cost you a ticket are the loudest
 * marks on the screen.
 */
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import type { SeatAvailabilityLevel } from "shared";
import { getSeatAvailabilityCopy } from "shared/showtimes/seat-availability-level";

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

const PRESENTATION: Record<
  string,
  { icon: MaterialIconName; color: (colors: ThemeColors) => string }
> = {
  some_taken: { icon: "person", color: (c) => c.teal.secondary },
  busy: { icon: "people", color: (c) => c.yellow.secondary },
  very_busy: { icon: "groups", color: (c) => c.orange.secondary },
  last_few: { icon: "whatshot", color: (c) => c.redHot.secondary },
  sold_out: { icon: "block", color: (c) => c.redDeep.secondary },
};

export function getSeatAvailabilityMeta(
  level: SeatAvailabilityLevel,
  colors: ThemeColors,
): SeatAvailabilityMeta | null {
  const copy = getSeatAvailabilityCopy(level);
  const presentation = PRESENTATION[level];
  // A level this build no longer knows has nothing to render rather than
  // crashing on it.
  if (!copy || !presentation) return null;
  return {
    ...copy,
    icon: presentation.icon,
    color: presentation.color(colors),
  };
}
