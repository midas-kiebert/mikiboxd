/**
 * Fallback poster shown wherever a movie has no poster image (currently just
 * sneak previews, whose film is unknown until showtime) — a big "?" on a
 * gradient card instead of a blank rectangle.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type PosterPlaceholderProps = {
  style?: StyleProp<ViewStyle>;
  glyphSize?: number;
};

export default function PosterPlaceholder({ style, glyphSize = 28 }: PosterPlaceholderProps) {
  const colors = useThemeColors();

  return (
    <View style={[styles.container, style]}>
      <LinearGradient
        colors={[colors.posterPlaceholder, colors.pillBackground]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <ThemedText
        style={[
          styles.glyph,
          { fontSize: glyphSize, lineHeight: glyphSize * 1.2, color: colors.textSecondary },
        ]}
      >
        ?
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glyph: {
    fontWeight: "800",
  },
});
