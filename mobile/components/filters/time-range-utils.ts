export const normalizeSingleTimeRangeSelection = (timeRanges: readonly string[]) =>
  timeRanges.length > 0 ? [timeRanges[0]!] : [];

export const formatTimePillLabel = (timeRanges: readonly string[]) => {
  const [range] = normalizeSingleTimeRangeSelection(timeRanges);
  if (!range) return "Any Time";

  const [startRaw = "", endRaw = ""] = range.split("-", 2);
  const start = startRaw.trim();
  const end = endRaw.trim();

  if (start && end) {
    return `${start}-${end}`;
  }
  if (start) {
    return `From ${start}`;
  }
  if (end) {
    return `Until ${end}`;
  }
  return "Any Time";
};
