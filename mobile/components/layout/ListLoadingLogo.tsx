import { StyleSheet, View } from "react-native";

import LoadingLogo from "@/components/layout/LoadingLogo";
import { useThemeColors } from "@/hooks/use-theme-color";

/**
 * What a movies/showtimes feed shows in place of its list while the first
 * page (or a pull-to-refresh) is in flight — the same panel the theme
 * curtain uses, sized down and dropped in wherever a feed used to fill its
 * empty state with skeleton rows.
 *
 * No spinner: every caller of this also has a `ThemedRefreshControl` pinned
 * above the list, so the logo would otherwise spin alongside it.
 *
 * Fills its parent (`flex: 1`) rather than sizing to its own content — a
 * caller drops this into a container that already spans the list's viewport,
 * as a fixed overlay rather than part of the list's own scrollable content.
 *
 * Sits a little above true center: dead center reads as low once the search
 * bar and filter row above it are accounted for, since those aren't part of
 * this box.
 */
export default function ListLoadingLogo() {
  const colors = useThemeColors();
  return (
    <View style={styles.container}>
      <View style={styles.topSpacer} />
      <LoadingLogo
        tintColor={colors.tint}
        labelColor={colors.textSecondary}
        logoSize={96}
        hideSpinner
        fadeIn
      />
      <View style={styles.bottomSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 200,
    alignItems: "center",
  },
  topSpacer: { flex: 1 },
  bottomSpacer: { flex: 1.6 },
});
