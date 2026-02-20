export type TimeFilterPreset = {
  id: "morning" | "afternoon" | "evening" | "night";
  label: string;
  range: string;
};

export const TIME_FILTER_PRESETS: ReadonlyArray<TimeFilterPreset> = [
  { id: "morning", label: "Morning", range: "06:00-11:59" },
  { id: "afternoon", label: "Afternoon", range: "12:00-17:59" },
  { id: "evening", label: "Evening", range: "18:00-21:59" },
  { id: "night", label: "Night", range: "22:00-05:59" },
] as const;

export function getPresetForRange(range: string): TimeFilterPreset | undefined {
  return TIME_FILTER_PRESETS.find((preset) => preset.range === range);
}
