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
import { useThemeColors } from "@/hooks/use-theme-color";

type CinemaColorKey =
  | "pink"
  | "purple"
  | "green"
  | "orange"
  | "yellow"
  | "blue"
  | "teal"
  | "red"
  | "cyan";

type CinemaColorPalette = {
  primary: string;
  secondary: string;
};

type CinemaPillProps = {
  cinema: CinemaPublic;
  variant?: "compact" | "default";
};

type VariantStyles = {
  container: ViewStyle;
  text: TextStyle;
};

const CINEMA_PILL_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

export default function CinemaPill({ cinema, variant = "default" }: CinemaPillProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
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

  // Backend provides a color key string; map it to the theme palette safely.
  const paletteByKey: Record<CinemaColorKey, CinemaColorPalette> = {
    pink: colors.pink,
    purple: colors.purple,
    green: colors.green,
    orange: colors.orange,
    yellow: colors.yellow,
    blue: colors.blue,
    teal: colors.teal,
    red: colors.red,
    cyan: colors.cyan,
  };
  const cinemaColorKey = cinema.badge_bg_color as CinemaColorKey;
  const fallbackPalettes = Object.values(paletteByKey);
  const fallbackPalette =
    fallbackPalettes[
      Math.abs(
        cinema.name.split("").reduce((hash, char) => hash * 31 + char.charCodeAt(0), 0)
      ) % fallbackPalettes.length
    ];
  const cinemaPalette = paletteByKey[cinemaColorKey] ?? fallbackPalette;
  const cinemaBackground = cinemaPalette.primary;
  const cinemaText = cinemaPalette.secondary;

  const handlePress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    router.push({
      pathname: "/cinema-showtimes/[id]",
      params: { id: cinema.id.toString(), name: cinema.name, city: cinema.city.name },
    });
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
