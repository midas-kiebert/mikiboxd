/**
 * The movie page's synopsis block, plus a "More info on Letterboxd" link when
 * the movie has its own Letterboxd page. Rendered as the showtimes
 * SectionList's ListHeaderComponent.
 */
import { useCallback, useMemo } from "react";
import { Linking, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type Props = {
  description: string;
  /** Only shown when the movie has its own Letterboxd page, not a search fallback. */
  letterboxdUrl?: string | null;
};

export default function MovieDescriptionSection({ description, letterboxdUrl }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleOpenLetterboxd = useCallback(async () => {
    if (!letterboxdUrl) return;
    try {
      await Linking.openURL(letterboxdUrl);
    } catch {
      // Ignore open failures to keep the movie page interaction non-blocking.
    }
  }, [letterboxdUrl]);

  return (
    <View style={styles.container}>
      <ThemedText style={styles.description}>{description}</ThemedText>
      {letterboxdUrl ? (
        <TouchableOpacity
          onPress={() => void handleOpenLetterboxd()}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel="More info on Letterboxd"
          hitSlop={{ top: 4, bottom: 8, left: 4, right: 4 }}
          style={styles.letterboxdLink}
        >
          <ThemedText style={styles.letterboxdLinkText}>More info on Letterboxd</ThemedText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    // Rendered as the showtimes SectionList's ListHeaderComponent, whose
    // contentContainerStyle already supplies the 16pt horizontal inset and the
    // gap to the next sibling — no padding of its own needed here.
    container: {},
    description: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    letterboxdLink: {
      alignSelf: "flex-start",
      marginTop: 6,
    },
    letterboxdLinkText: {
      fontSize: 12,
      color: colors.textSecondary,
      textDecorationLine: "underline",
    },
  });
