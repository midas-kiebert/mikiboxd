import { DateTime } from "luxon";

import { UNKNOWN_METADATA_PLACEHOLDER } from "@/constants/synthetic-movies";

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
