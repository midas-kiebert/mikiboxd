import { useRef } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type FilterPillLongPressPosition } from '@/components/filters/FilterPills';
import { useThemeColors } from '@/hooks/use-theme-color';

type FilterPresetFabProps = {
  isPopoverVisible: boolean;
  onOpen: (anchor: FilterPillLongPressPosition) => void;
  onLongPress?: () => void;
};

const FAB_SIZE = 56;
const FAB_RIGHT_OFFSET = 16;
const FAB_BOTTOM_OFFSET = -10;
const FAB_IDLE_OPACITY = 0.4;

const tintWithOpacity = (hexColor: string, alpha: number) => {
  if (!hexColor.startsWith('#')) return hexColor;
  const raw = hexColor.slice(1);
  const normalized =
    raw.length === 3 ? raw.split('').map((value) => `${value}${value}`).join('') : raw;
  if (normalized.length !== 6) return hexColor;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return hexColor;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

export default function FilterPresetFab({
  isPopoverVisible,
  onOpen,
  onLongPress,
}: FilterPresetFabProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const fabRef = useRef<View | null>(null);

  const handlePress = () => {
    const fallbackAnchor = {
      pageX: screenWidth - FAB_RIGHT_OFFSET - FAB_SIZE / 2,
      pageY: screenHeight - insets.bottom - FAB_BOTTOM_OFFSET - FAB_SIZE,
    };
    if (!fabRef.current) {
      onOpen(fallbackAnchor);
      return;
    }
    fabRef.current.measureInWindow((x: number, y: number, width: number) => {
      onOpen({
        pageX: x + width / 2,
        pageY: y,
      });
    });
  };

  return (
    <TouchableOpacity
      ref={fabRef}
      style={{
        position: 'absolute',
        right: FAB_RIGHT_OFFSET,
        bottom: insets.bottom + FAB_BOTTOM_OFFSET,
        width: FAB_SIZE,
        height: FAB_SIZE,
        borderRadius: FAB_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isPopoverVisible
          ? colors.tint
          : tintWithOpacity(colors.tint, FAB_IDLE_OPACITY),
        borderWidth: 1.5,
        borderColor: colors.background,
      }}
      onPress={handlePress}
      onLongPress={onLongPress}
      delayLongPress={230}
      activeOpacity={0.74}
    >
      <MaterialIcons name='bookmark' size={24} color={colors.pillActiveText} />
    </TouchableOpacity>
  );
}
