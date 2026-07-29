/**
 * Mobile badge component: Cinema Pill.
 */
import {
  StyleSheet,
  TouchableOpacity,
  type GestureResponderEvent,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import type { CinemaPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getCinemaColorPalette } from "@/utils/cinema-color";

type CinemaPillProps = {
  cinema: CinemaPublic;
  variant?: "compact" | "default";
  disabledIfSameId?: number;
};

type VariantStyles = {
  container: ViewStyle;
  text: TextStyle;
};

const CINEMA_PILL_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

export default function CinemaPill({ cinema, variant = "default", disabledIfSameId }: CinemaPillProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  const goToCinemaShowtimes = useSingleFireNavigation((c: CinemaPublic) =>
    router.push({
      pathname: "/cinema-showtimes/[id]",
      params: {
        id: c.id.toString(),
        name: c.name,
        city: c.city.name,
        badgeBgColor: c.badge_bg_color,
        url: c.url,
      },
    })
  );
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Size variant keeps the same badge logic reusable in compact rows and full cards.
  const sizeStyles: VariantStyles =
    variant === "compact"
      ? {
          container: styles.compactContainer,
          text: styles.compactText,
        }
      : {
          container: styles.defaultContainer,
          text: styles.defaultText,
        };

  const cinemaPalette = getCinemaColorPalette(cinema, colors);
  const cinemaBackground = cinemaPalette.primary;
  const cinemaText = cinemaPalette.secondary;

  const isDisabled = disabledIfSameId !== undefined && cinema.id === disabledIfSameId;

  const handlePress = (event: GestureResponderEvent) => {
    if (isDisabled) return;
    event.stopPropagation();
    goToCinemaShowtimes(cinema);
  };

  // Render/output using the state and derived values prepared above.
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.75}
      hitSlop={CINEMA_PILL_HIT_SLOP}
      style={[
        styles.container,
        sizeStyles.container,
        { backgroundColor: cinemaBackground, borderColor: cinemaText },
      ]}
    >
      <ThemedText
        style={[styles.text, sizeStyles.text, { color: cinemaText }]}
        numberOfLines={1}
      >
        {cinema.name}
      </ThemedText>
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      borderWidth: 1,
      borderRadius: 3,
      justifyContent: "center",
      alignItems: "center",
      maxWidth: "65%",
      paddingHorizontal: 6,
    },
    text: {
      includeFontPadding: false,
    },
    compactContainer: {
      borderRadius: 3,
      minHeight: 14,
      paddingVertical: 1,
      paddingHorizontal: 5,
    },
    compactText: {
      fontSize: 9,
      lineHeight: 10,
    },
    defaultContainer: {
      minHeight: 18,
      paddingVertical: 1,
      paddingHorizontal: 6,
    },
    defaultText: {
      fontSize: 11,
      lineHeight: 12,
    },
  });
