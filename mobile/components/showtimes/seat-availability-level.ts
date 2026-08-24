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
 * A ramp rather than five unrelated colours: green through yellow and orange to
 * red, so the level reads before the label does. The icons are seat-shaped for
 * the two calm levels and people-shaped for the two busy ones, which is the
 * distinction someone deciding whether to book actually cares about.
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
        icon: "airline-seat-recline-extra",
        color: colors.green.secondary,
      };
    case "some_taken":
      return {
        level,
        label: "Some seats taken",
        description: "Filling up — the best seats may already be gone.",
        icon: "event-seat",
        color: colors.teal.secondary,
      };
    case "busy":
      return {
        level,
        label: "Busy",
        description: "Plenty of seats left, but not the whole room.",
        icon: "groups",
        color: colors.yellow.secondary,
      };
    case "nearly_sold_out":
      return {
        level,
        label: "Almost sold out",
        description: "Very busy — this could sell out.",
        icon: "local-fire-department",
        color: colors.orange.secondary,
      };
    case "sold_out":
      return {
        level,
        label: "Sold out",
        description: "No seats left the last time we looked.",
        icon: "do-not-disturb-on",
        color: colors.red.secondary,
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
