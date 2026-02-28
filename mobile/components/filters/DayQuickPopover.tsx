import { useCallback, useMemo } from "react";

import { type FilterPillLongPressPosition } from "@/components/filters/FilterPills";
import SelectionQuickPopover, {
  type QuickSelectionPopoverOption,
} from "@/components/filters/SelectionQuickPopover";
import {
  RELATIVE_DAY_OPTIONS,
  canonicalizeDaySelections,
} from "@/components/filters/day-filter-utils";

type DayQuickPopoverProps = {
  visible: boolean;
  anchor: FilterPillLongPressPosition | null;
  onClose: () => void;
  selectedDays: string[];
  onChange: (days: string[]) => void;
  onOpenModal: () => void;
};

type DayQuickOption = QuickSelectionPopoverOption & {
  days: string[];
};

const ANY_DAY_OPTION_ID = "any-day";

const DAY_QUICK_OPTIONS: ReadonlyArray<DayQuickOption> = [
  { id: ANY_DAY_OPTION_ID, label: "Any Day", days: [] },
  ...RELATIVE_DAY_OPTIONS.map((option) => ({
    id: option.token,
    label: option.label,
    days: [option.token],
  })),
];

const DAY_QUICK_OPTIONS_BY_ID = new Map(DAY_QUICK_OPTIONS.map((option) => [option.id, option]));
const DAY_QUICK_OPTION_IDS = new Set(DAY_QUICK_OPTIONS.map((option) => option.id));

const DAY_QUICK_POPOVER_OPTIONS: ReadonlyArray<QuickSelectionPopoverOption> = DAY_QUICK_OPTIONS.map(
  ({ id, label, meta }) => ({ id, label, meta })
);

export default function DayQuickPopover({
  visible,
  anchor,
  onClose,
  selectedDays,
  onChange,
  onOpenModal,
}: DayQuickPopoverProps) {
  const normalizedSelectedDays = useMemo(
    () => canonicalizeDaySelections(selectedDays) ?? [],
    [selectedDays]
  );

  const selectedOptionId = useMemo(() => {
    if (normalizedSelectedDays.length === 0) return ANY_DAY_OPTION_ID;
    if (normalizedSelectedDays.length !== 1) return null;
    const [selection] = normalizedSelectedDays;
    return DAY_QUICK_OPTION_IDS.has(selection) ? selection : null;
  }, [normalizedSelectedDays]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      const option = DAY_QUICK_OPTIONS_BY_ID.get(optionId);
      if (!option) return;
      onChange([...option.days]);
    },
    [onChange]
  );

  return (
    <SelectionQuickPopover
      visible={visible}
      anchor={anchor}
      onClose={onClose}
      title="Days"
      options={DAY_QUICK_POPOVER_OPTIONS}
      selectedOptionId={selectedOptionId}
      onSelectOption={handleSelectOption}
      footerActionLabel="Open full day filter"
      onPressFooterAction={onOpenModal}
    />
  );
}
