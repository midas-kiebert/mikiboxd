import {
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
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

export default function CinemaPill({ cinema, variant = "default" }: CinemaPillProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
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

  const cinemaColorKey = cinema.badge_bg_color as CinemaColorKey;
  const cinemaPalette = (colors as Record<CinemaColorKey, CinemaColorPalette>)[
    cinemaColorKey
  ];
  const cinemaBackground = cinemaPalette?.primary ?? colors.pillBackground;
  const cinemaText = cinemaPalette?.secondary ?? colors.textSecondary;

  return (
    <View
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
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      borderWidth: 1,
      borderRadius: 3,
      justifyContent: "center",
      maxWidth: "65%",
      paddingHorizontal: 6,
    },
    text: {
      includeFontPadding: false,
      textAlignVertical: "center",
    },
    compactContainer: {
      borderRadius: 2,
      height: 12,
      paddingHorizontal: 5,
    },
    compactText: {
      fontSize: 9,
      lineHeight: 12,
    },
    defaultContainer: {
      height: 16,
      paddingHorizontal: 6,
    },
    defaultText: {
      fontSize: 11,
      lineHeight: 14,
    },
  });
