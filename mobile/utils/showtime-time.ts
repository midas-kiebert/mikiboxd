import { DateTime } from "luxon";

import { UNKNOWN_METADATA_PLACEHOLDER } from "@/constants/synthetic-movies";

const SHOWTIME_TIME_ZONE = "Europe/Amsterdam";

/** Showtime datetimes are zone-less Amsterdam wall-clock times, so they are
 * compared in that zone rather than in the device's. */
export const hasShowtimeStarted = (startDatetime: string) => {
  const start = DateTime.fromISO(startDatetime, { zone: SHOWTIME_TIME_ZONE });
  if (!start.isValid) return false;
  return start < DateTime.now().setZone(SHOWTIME_TIME_ZONE);
};

export const formatShowtimeTimeRange = (
  startDatetime: string,
  endDatetime?: string | null,
  isSyntheticMovie?: boolean
) => {
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
