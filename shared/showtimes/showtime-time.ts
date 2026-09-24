/**
 * When a screening runs, written the one way both clients write it.
 *
 * Showtime datetimes are zone-less Amsterdam wall-clock times, so "has it
 * started" is answered in that zone and never in the device's — a phone in
 * another timezone must not decide a 20:30 screening is over.
 */
import { DateTime } from "luxon";

import { UNKNOWN_METADATA_PLACEHOLDER } from "../movies/synthetic-movie";

const SHOWTIME_TIME_ZONE = "Europe/Amsterdam";

export const hasShowtimeStarted = (startDatetime: string): boolean => {
  const start = DateTime.fromISO(startDatetime, { zone: SHOWTIME_TIME_ZONE });
  if (!start.isValid) return false;
  return start < DateTime.now().setZone(SHOWTIME_TIME_ZONE);
};

/** "20:30~22:36", or just "20:30" when the end is unknown. */
export const formatShowtimeTimeRange = (
  startDatetime: string,
  endDatetime?: string | null,
  isSyntheticMovie?: boolean,
): string => {
  const startTime = DateTime.fromISO(startDatetime).toFormat("HH:mm");
  const end = endDatetime ? DateTime.fromISO(endDatetime) : null;
  if (end?.isValid) {
    return `${startTime}~${end.toFormat("HH:mm")}`;
  }

  if (isSyntheticMovie) {
    return `${startTime}~${UNKNOWN_METADATA_PLACEHOLDER}`;
  }

  return startTime;
};
