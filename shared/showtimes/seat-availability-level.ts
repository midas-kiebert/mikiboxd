/**
 * How one busyness level is worded, and the seat/timestamp formatting that goes
 * with it.
 *
 * Split out of the app's module so the website says the same thing about the
 * same level — the label, the description, the "31 of 312 seats left" wording,
 * and now the icon and which palette draws it. Only resolving those last two
 * against a theme is the client's own: the app hands the name to MaterialIcons
 * and the web to the matching `react-icons/md` component.
 *
 * The cutoffs behind these levels live in the backend and are never recomputed
 * here: the client is handed a level and picks how to draw it.
 */
import { DateTime } from "luxon";
import type {
  SeatAvailabilityLevel,
  ShowtimeSeatAvailabilityPublic,
} from "../client";

/**
 * The mark a level carries, as a single progression rather than five unrelated
 * icons: a lone silhouette, then the room filling one more at a time, then a
 * flame, then a closed sign. Rank is in the shape as well as the colour, which
 * is what makes the badge readable at the 12px a list row gives it.
 *
 * The colours ramp teal → yellow → orange → hot red → deep red, ending on two
 * reds so the two states that actually cost you a ticket are the loudest marks
 * on the screen.
 */
export type SeatAvailabilityPresentation = {
  /** A MaterialIcons name; both clients resolve it to their own icon set. */
  icon: "person" | "people" | "groups" | "whatshot" | "block";
  /** Which palette trio draws it. */
  palette: "teal" | "yellow" | "orange" | "redHot" | "redDeep";
};

const PRESENTATION: Record<string, SeatAvailabilityPresentation> = {
  some_taken: { icon: "person", palette: "teal" },
  busy: { icon: "people", palette: "yellow" },
  very_busy: { icon: "groups", palette: "orange" },
  last_few: { icon: "whatshot", palette: "redHot" },
  sold_out: { icon: "block", palette: "redDeep" },
};

/** Null for a level this build no longer knows, so it draws nothing. */
export function getSeatAvailabilityPresentation(
  level: SeatAvailabilityLevel
): SeatAvailabilityPresentation | null {
  return PRESENTATION[level] ?? null;
}

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
