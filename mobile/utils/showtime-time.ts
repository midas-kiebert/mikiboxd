import { DateTime } from "luxon";

export const formatShowtimeTimeRange = (
  startDatetime: string,
  endDatetime?: string | null
) => {
  const startTime = DateTime.fromISO(startDatetime).toFormat("HH:mm");
  if (!endDatetime) {
    return startTime;
  }

  const end = DateTime.fromISO(endDatetime);
  if (!end.isValid) {
    return startTime;
  }

  return `${startTime}~${end.toFormat("HH:mm")}`;
};
