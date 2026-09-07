/**
 * How one busyness level is worded, and the seat/timestamp formatting that goes
 * with it.
 *
 * Split out of the app's module so the website says the same thing about the
 * same level. The icon and colour stay platform-specific — the app's are
 * MaterialIcons names against its theme — but the label, the description and
 * the "31 of 312 seats left" wording are the same on both.
 *
 * The cutoffs behind these levels live in the backend and are never recomputed
 * here: the client is handed a level and picks how to draw it.
 */
import { DateTime } from "luxon";
import type {
  SeatAvailabilityLevel,
  ShowtimeSeatAvailabilityPublic,
} from "../client";

export type SeatAvailabilityCopy = {
  level: SeatAvailabilityLevel;
  label: string;
  description: string;
};

export function getSeatAvailabilityCopy(
  level: SeatAvailabilityLevel
): SeatAvailabilityCopy | null {
  switch (level) {
    case "some_taken":
      return {
        level,
        label: "Nearly empty",
        description: "Pick any seat you like.",
      };
    case "busy":
      return {
        level,
        label: "Busy",
        description: "About half the room is gone — the best seats may be too.",
      };
    case "very_busy":
      return {
        level,
        label: "Very busy",
        description: "Filling fast, and the seats left are the leftovers.",
      };
    case "last_few":
      return {
        level,
        label: "Last few seats",
        description: "Down to the final seats — this could sell out.",
      };
    case "sold_out":
      return {
        level,
        label: "Sold out",
        description: "No seats left the last time we looked.",
      };
    default:
      // A level this build no longer knows (e.g. a stale cached value persisted
      // from before a busyness-scale change like the retired `empty` bucket)
      // has nothing to render rather than crashing on it.
      return null;
  }
}

/** "31 of 312 seats left", or as much of that as we actually know. */
export function formatSeatCount(
  availability: ShowtimeSeatAvailabilityPublic
): string | null {
  const { seats_left: seatsLeft, seats_capacity: capacity } = availability;
  if (seatsLeft === null || seatsLeft === undefined) return null;
  if (seatsLeft === 0) return "No seats left";
  const seatWord = seatsLeft === 1 ? "seat" : "seats";
  if (!capacity) return `${seatsLeft} ${seatWord} left`;
  return `${seatsLeft} of ${capacity} ${seatWord} left`;
}

/** "Checked 5 minutes ago" — how much to trust the number above it. */
export function formatCheckedAt(
  checkedAt: string | null | undefined
): string | null {
  if (!checkedAt) return null;
  return `Checked ${DateTime.fromISO(checkedAt).toRelative()}`;
}

/** "checked 5m ago" — a compact version for use next to a badge in a list row. */
export function formatCheckedAtShort(
  checkedAt: string | null | undefined
): string | null {
  if (!checkedAt) return null;
  const minutes = Math.max(
    0,
    Math.round(DateTime.now().diff(DateTime.fromISO(checkedAt), "minutes").minutes)
  );
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `checked ${days}d ago`;
}

/**
 * The calmest rung of the scale — a room that is still almost entirely free.
 *
 * Kept as a set rather than a comparison so a future scale change reads as one
 * edit here, and so an unknown/retired level never accidentally counts as calm.
 */
const CALM_LEVELS: SeatAvailabilityLevel[] = ["some_taken"];

/**
 * Whether a level is worth drawing where the badge is a bare icon.
 *
 * The icon exists to say "hurry if you want a ticket". "Nearly empty" is the
 * absence of that, so on a dense row it costs the reader a glance and tells
 * them nothing. Where the badge carries its seat count every level still shows,
 * because the number itself is the information.
 */
export function isUrgentSeatAvailabilityLevel(
  level: SeatAvailabilityLevel
): boolean {
  return !CALM_LEVELS.includes(level);
}
