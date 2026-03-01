export const RUNTIME_MIN_MINUTES = 20;
export const RUNTIME_MAX_MINUTES = 240;
export const RUNTIME_STEP_MINUTES = 5;

export const normalizeSingleRuntimeRangeSelection = (runtimeRanges: readonly string[]) =>
  runtimeRanges.length > 0 ? [runtimeRanges[0]!] : [];

const parseRuntimeBound = (value: string): number | undefined => {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  if (parsed < RUNTIME_MIN_MINUTES || parsed > RUNTIME_MAX_MINUTES) return undefined;
  return parsed;
};

export const getRuntimeBoundsFromSelections = (runtimeRanges: readonly string[]) => {
  const [range] = normalizeSingleRuntimeRangeSelection(runtimeRanges);
  if (!range) {
    return {
      runtimeMin: undefined,
      runtimeMax: undefined,
    };
  }

  const [startRaw = "", endRaw = ""] = range.split("-", 2);
  const runtimeMin = parseRuntimeBound(startRaw);
  const runtimeMax = parseRuntimeBound(endRaw);
  if (
    runtimeMin !== undefined &&
    runtimeMax !== undefined &&
    runtimeMin > runtimeMax
  ) {
    return {
      runtimeMin: undefined,
      runtimeMax: undefined,
    };
  }

  return {
    runtimeMin,
    runtimeMax,
  };
};

export const formatRuntimePillLabel = (runtimeRanges: readonly string[]) => {
  const [range] = normalizeSingleRuntimeRangeSelection(runtimeRanges);
  if (!range) return "Any Runtime";

  const [startRaw = "", endRaw = ""] = range.split("-", 2);
  const start = parseRuntimeBound(startRaw);
  const end = parseRuntimeBound(endRaw);

  if (start && end) {
    return `${start}-${end} min`;
  }
  if (start) {
    return `>${start} min`;
  }
  if (end) {
    return `<${end} min`;
  }
  return "Any Runtime";
};
