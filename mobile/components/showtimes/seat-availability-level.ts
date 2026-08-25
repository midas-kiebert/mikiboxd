import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import { DateTime } from "luxon";
import type { SeatAvailabilityLevel, ShowtimeSeatAvailabilityPublic } from "shared";

import type { Colors } from "@/constants/theme";

type ThemeColors = typeof Colors.light;
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

export type SeatAvailabilityMeta = {
  level: SeatAvailabilityLevel;
  label: string;
  description: string;
  icon: MaterialIconName;
  color: string;
};

/**
 * The icon, wording and colour for one busyness level.
 *
 * The icons are a single progression, not six unrelated marks: an empty seat,
 * then the room filling one silhouette at a time, then a flame, then a closed
 * sign. Rank is in the shape as well as the colour, which is what makes the
 * badge readable at the 12px it renders at in a list row.
 *
 * The colours ramp teal → green → yellow → orange → red → deep red, ending on
 * two reds so the two states that actually cost you a ticket are the darkest
 * marks on the screen.
 *
 * The cutoffs behind these live in the backend and are never recomputed here —
 * the client is handed a level and picks how to draw it.
 */
export function getSeatAvailabilityMeta(
  level: SeatAvailabilityLevel,
  colors: ThemeColors,
): SeatAvailabilityMeta {
  switch (level) {
    case "empty":
      return {
        level,
        label: "Nearly empty",
        description: "Pick any seat you like.",
        icon: "event-seat",
        color: colors.teal.secondary,
      };
    case "some_taken":
      return {
        level,
        label: "Some seats taken",
        description: "Filling up, but most of the room is still free.",
        icon: "person",
        color: colors.green.secondary,
      };
    case "busy":
      return {
        level,
        label: "Busy",
        description: "About half the room is gone — the best seats may be too.",
        icon: "people",
        color: colors.yellow.secondary,
      };
    case "very_busy":
      return {
        level,
        label: "Very busy",
        description: "Filling fast, and the seats left are the leftovers.",
        icon: "groups",
        color: colors.orange.secondary,
      };
    case "last_few":
      return {
        level,
        label: "Last few seats",
        description: "Down to the final seats — this could sell out.",
        icon: "whatshot",
        color: colors.red.secondary,
      };
    case "sold_out":
      return {
        level,
        label: "Sold out",
        description: "No seats left the last time we looked.",
        icon: "block",
        color: colors.redDeep.secondary,
      };
  }
}

/** "31 of 312 seats left", or as much of that as we actually know. */
export function formatSeatCount(
  availability: ShowtimeSeatAvailabilityPublic,
): string | null {
  const { seats_left: seatsLeft, seats_capacity: capacity } = availability;
  if (seatsLeft === null || seatsLeft === undefined) return null;
  if (seatsLeft === 0) return "No seats left";
  const seatWord = seatsLeft === 1 ? "seat" : "seats";
  if (!capacity) return `${seatsLeft} ${seatWord} left`;
  return `${seatsLeft} of ${capacity} ${seatWord} left`;
}

/** "Checked 5 minutes ago" — how much to trust the number above it. */
export function formatCheckedAt(checkedAt: string | null | undefined): string | null {
  if (!checkedAt) return null;
  return `Checked ${DateTime.fromISO(checkedAt).toRelative()}`;
}

/** "checked 5m ago" — a compact version for use next to the badge in a list row. */
export function formatCheckedAtShort(checkedAt: string | null | undefined): string | null {
  if (!checkedAt) return null;
  const minutes = Math.max(0, Math.round(DateTime.now().diff(DateTime.fromISO(checkedAt), "minutes").minutes));
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `checked ${days}d ago`;
}
