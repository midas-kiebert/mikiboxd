/**
 * The app's on/off switch: React Native's `Switch`, coloured so it reads as the
 * platform's own control.
 *
 * It exists because iOS and Android want opposite things from the same props.
 * `trackColor.false` maps to UISwitch's `tintColor`, which iOS draws as a thin
 * *outline* around an unfilled track — so an off switch with a white
 * `thumbColor` on top of a near-white card is a pale empty capsule with no
 * visible thumb, which is what made these look like wide grey blobs. iOS gets
 * `ios_backgroundColor` (the actual off-state fill) and no thumb override, so
 * the system draws its usual white thumb with its shadow; Android, which has no
 * sensible defaults of its own, keeps the explicit thumb and track colours.
 */
import { Platform, Switch } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme-color';
import { triggerSelectionHaptic } from '@/utils/long-press';

const ANDROID_THUMB_COLOR = '#ffffff';

type AppSwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export default function AppSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: AppSwitchProps) {
  const colors = useThemeColors();

  const handleValueChange = (next: boolean) => {
    triggerSelectionHaptic();
    onValueChange(next);
  };

  return (
    <Switch
      value={value}
      onValueChange={handleValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: colors.divider, true: colors.tint }}
      // Only Android needs a thumb colour; on iOS this would replace the system
      // thumb (white, with a shadow) with a flat white circle.
      thumbColor={Platform.OS === 'android' ? ANDROID_THUMB_COLOR : undefined}
      ios_backgroundColor={colors.divider}
    />
  );
}
