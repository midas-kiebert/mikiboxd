import { useCallback, useMemo } from "react";

import { type FilterPillLongPressPosition } from "@/components/filters/FilterPills";
import SelectionQuickPopover, {
  type QuickSelectionPopoverOption,
} from "@/components/filters/SelectionQuickPopover";
import { TIME_FILTER_PRESETS } from "@/components/filters/time-filter-presets";

type TimeQuickPopoverProps = {
  visible: boolean;
  anchor: FilterPillLongPressPosition | null;
  onClose: () => void;
  selectedTimeRanges: string[];
  onChange: (timeRanges: string[]) => void;
  onOpenModal: () => void;
};

type TimeQuickOption = QuickSelectionPopoverOption & {
  timeRanges: string[];
};

const ANY_TIME_OPTION_ID = "any-time";

const TIME_QUICK_OPTIONS: ReadonlyArray<TimeQuickOption> = [
  { id: ANY_TIME_OPTION_ID, label: "Any Time", timeRanges: [] },
  ...TIME_FILTER_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    meta: preset.range,
    timeRanges: [preset.range],
  })),
];

const TIME_QUICK_OPTIONS_BY_ID = new Map(TIME_QUICK_OPTIONS.map((option) => [option.id, option]));
const TIME_OPTION_ID_BY_RANGE = new Map(TIME_FILTER_PRESETS.map((preset) => [preset.range, preset.id]));

const TIME_QUICK_POPOVER_OPTIONS: ReadonlyArray<QuickSelectionPopoverOption> = TIME_QUICK_OPTIONS.map(
  ({ id, label, meta }) => ({ id, label, meta })
);

export default function TimeQuickPopover({
  visible,
  anchor,
  onClose,
  selectedTimeRanges,
  onChange,
  onOpenModal,
}: TimeQuickPopoverProps) {
  const normalizedSelectedTimeRanges = useMemo(
    () => Array.from(new Set(selectedTimeRanges)),
    [selectedTimeRanges]
  );

  const selectedOptionId = useMemo(() => {
    if (normalizedSelectedTimeRanges.length === 0) return ANY_TIME_OPTION_ID;
    if (normalizedSelectedTimeRanges.length !== 1) return null;
    const [timeRange] = normalizedSelectedTimeRanges;
    return TIME_OPTION_ID_BY_RANGE.get(timeRange) ?? null;
  }, [normalizedSelectedTimeRanges]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      const option = TIME_QUICK_OPTIONS_BY_ID.get(optionId);
      if (!option) return;
      onChange([...option.timeRanges]);
    },
    [onChange]
  );

  return (
    <SelectionQuickPopover
      visible={visible}
      anchor={anchor}
      onClose={onClose}
      title="Times"
      options={TIME_QUICK_POPOVER_OPTIONS}
      selectedOptionId={selectedOptionId}
      onSelectOption={handleSelectOption}
      footerActionLabel="Open full time filter"
      onPressFooterAction={onOpenModal}
    />
  );
}
