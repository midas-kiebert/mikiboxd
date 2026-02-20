import { DateTime } from "luxon";

export const AMSTERDAM_ZONE = "Europe/Amsterdam";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAY_RANGE = 180;

export type RelativeDayToken =
  | "relative:today"
  | "relative:tomorrow"
  | "relative:day_after_tomorrow";

type RelativeDayOption = {
  token: RelativeDayToken;
  label: string;
  offset: number;
};

type WeekdayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeekdayDayToken = `weekday:${WeekdayNumber}`;

type WeekdayDayOption = {
  token: WeekdayDayToken;
  label: string;
  shortLabel: string;
  weekday: WeekdayNumber;
};

export const RELATIVE_DAY_OPTIONS: ReadonlyArray<RelativeDayOption> = [
  { token: "relative:today", label: "Today", offset: 0 },
  { token: "relative:tomorrow", label: "Tomorrow", offset: 1 },
  { token: "relative:day_after_tomorrow", label: "Day After Tomorrow", offset: 2 },
] as const;

export const WEEKDAY_DAY_OPTIONS: ReadonlyArray<WeekdayDayOption> = [
  { token: "weekday:1", label: "Monday", shortLabel: "Mon", weekday: 1 },
  { token: "weekday:2", label: "Tuesday", shortLabel: "Tue", weekday: 2 },
  { token: "weekday:3", label: "Wednesday", shortLabel: "Wed", weekday: 3 },
  { token: "weekday:4", label: "Thursday", shortLabel: "Thu", weekday: 4 },
  { token: "weekday:5", label: "Friday", shortLabel: "Fri", weekday: 5 },
  { token: "weekday:6", label: "Saturday", shortLabel: "Sat", weekday: 6 },
  { token: "weekday:7", label: "Sunday", shortLabel: "Sun", weekday: 7 },
] as const;

const RELATIVE_DAY_BY_TOKEN = new Map(
  RELATIVE_DAY_OPTIONS.map((option) => [option.token, option])
);
const WEEKDAY_DAY_BY_TOKEN = new Map(WEEKDAY_DAY_OPTIONS.map((option) => [option.token, option]));

export function isIsoDaySelection(value: string): boolean {
  return ISO_DATE_PATTERN.test(value);
}

function getRelativeDayOption(token: string): RelativeDayOption | undefined {
  return RELATIVE_DAY_BY_TOKEN.get(token as RelativeDayToken);
}

function getWeekdayDayOption(token: string): WeekdayDayOption | undefined {
  return WEEKDAY_DAY_BY_TOKEN.get(token as WeekdayDayToken);
}

function compareDaySelections(left: string, right: string): number {
  const leftRelative = getRelativeDayOption(left);
  const rightRelative = getRelativeDayOption(right);
  if (leftRelative && rightRelative) return leftRelative.offset - rightRelative.offset;
  if (leftRelative) return -1;
  if (rightRelative) return 1;

  const leftWeekday = getWeekdayDayOption(left);
  const rightWeekday = getWeekdayDayOption(right);
  if (leftWeekday && rightWeekday) return leftWeekday.weekday - rightWeekday.weekday;
  if (leftWeekday) return -1;
  if (rightWeekday) return 1;

  const leftIsIso = isIsoDaySelection(left);
  const rightIsIso = isIsoDaySelection(right);
  if (leftIsIso && rightIsIso) return left.localeCompare(right);
  if (leftIsIso) return -1;
  if (rightIsIso) return 1;

  return left.localeCompare(right);
}

export function getSortedUniqueDaySelections(values?: string[] | null): string[] | null {
  if (!values || values.length === 0) return null;
  return Array.from(new Set(values)).sort(compareDaySelections);
}

export function canonicalizeDaySelections(
  values?: string[] | null,
  referenceDate?: DateTime
): string[] | null {
  const sortedUnique = getSortedUniqueDaySelections(values);
  if (!sortedUnique) return null;

  const anchor = (referenceDate ?? DateTime.now().setZone(AMSTERDAM_ZONE)).startOf("day");
  const nextSelectionSet = new Set(sortedUnique);

  RELATIVE_DAY_OPTIONS.forEach((option) => {
    const iso = anchor.plus({ days: option.offset }).toISODate();
    if (!iso) return;
    if (nextSelectionSet.has(iso) || nextSelectionSet.has(option.token)) {
      nextSelectionSet.add(option.token);
      nextSelectionSet.delete(iso);
    }
  });

  return getSortedUniqueDaySelections(Array.from(nextSelectionSet));
}

export function resolveDaySelectionsForApi(
  values?: string[] | null,
  options?: {
    startDate?: DateTime;
    dayRange?: number;
  }
): string[] | undefined {
  const startDate = (options?.startDate ?? DateTime.now().setZone(AMSTERDAM_ZONE)).startOf("day");
  const dayRange = Math.max(1, options?.dayRange ?? DEFAULT_DAY_RANGE);
  const canonicalSelections = canonicalizeDaySelections(values, startDate);
  if (!canonicalSelections || canonicalSelections.length === 0) return undefined;

  const resolvedDaySet = new Set<string>();
  canonicalSelections.forEach((selectionValue) => {
    if (isIsoDaySelection(selectionValue)) {
      resolvedDaySet.add(selectionValue);
      return;
    }

    const relativeOption = getRelativeDayOption(selectionValue);
    if (relativeOption) {
      const iso = startDate.plus({ days: relativeOption.offset }).toISODate();
      if (iso) resolvedDaySet.add(iso);
      return;
    }

    const weekdayOption = getWeekdayDayOption(selectionValue);
    if (weekdayOption) {
      for (let index = 0; index < dayRange; index += 1) {
        const date = startDate.plus({ days: index });
        if (date.weekday !== weekdayOption.weekday) continue;
        const iso = date.toISODate();
        if (iso) resolvedDaySet.add(iso);
      }
    }
  });

  if (resolvedDaySet.size === 0) return undefined;
  return Array.from(resolvedDaySet).sort((left, right) => left.localeCompare(right));
}

export function getDaySelectionLabel(value: string): string {
  const relativeOption = getRelativeDayOption(value);
  if (relativeOption) return relativeOption.label;

  const weekdayOption = getWeekdayDayOption(value);
  if (weekdayOption) return weekdayOption.label;

  if (isIsoDaySelection(value)) {
    const date = DateTime.fromISO(value, { zone: AMSTERDAM_ZONE });
    if (date.isValid) return date.toFormat("EEE d LLL");
  }

  return value;
}

export function getDaySelectionLabels(values?: string[] | null): string[] {
  const selections = canonicalizeDaySelections(values);
  if (!selections || selections.length === 0) return [];
  return selections.map((selectionValue) => getDaySelectionLabel(selectionValue));
}
