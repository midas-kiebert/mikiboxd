/**
 * Mobile badge component: Subtitles Badges.
 */
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type SubtitlesBadgesProps = {
  subtitles?: Array<string> | null;
  variant?: "compact" | "default";
};

// Fixed render order; codes match app.core.enums.Language on the backend.
const SUBTITLE_LABELS_BY_CODE: ReadonlyArray<readonly [string, string]> = [
  ["nl", "NL SUBS"],
  ["en", "ENG SUBS"],
];

export default function SubtitlesBadges({ subtitles, variant = "default" }: SubtitlesBadgesProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  if (!subtitles?.length) return null;

  const isCompact = variant === "compact";
  const containerStyle = isCompact ? styles.compactContainer : styles.defaultContainer;
  const textStyle = isCompact ? styles.compactText : styles.defaultText;

  const labels = SUBTITLE_LABELS_BY_CODE.filter(([code]) => subtitles.includes(code)).map(
    ([, label]) => label
  );

  return (
    <>
      {labels.map((label) => (
        <View key={label} style={[styles.container, containerStyle]}>
          <ThemedText style={[styles.text, textStyle]} numberOfLines={1}>
            {label}
          </ThemedText>
        </View>
      ))}
    </>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      borderRadius: 3,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: `${colors.divider}80`,
    },
    text: {
      includeFontPadding: false,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    compactContainer: {
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
