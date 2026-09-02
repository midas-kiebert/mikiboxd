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
 * **Never show this for a pull-to-refresh.** RefreshControl's own spinner is
 * the whole answer to that gesture; this panel on top of it reads as the
 * screen being thrown away and rebuilt, and it moves with the pull. Every
 * condition that puts this up must carry `&& !refreshing` (or be a mount-time
 * shell, where there is no refresh to speak of) — see the call sites in
 * ShowtimesScreen, the feeds, friends and movie/[id].
 *
 * Fills its parent (`flex: 1`, over a 200pt floor) rather than sizing to its
 * own content — a caller normally drops this into a container that already
 * spans the list's viewport, as a fixed overlay rather than part of the list's
 * own scrollable content.
 *
 * The movie page is the exception, and shows when that rule stops applying: its
 * list is headed by the movie's description, which is already loaded and can run
 * long, so an overlay centred on the viewport printed the logo over perfectly
 * good text. There this goes in the list's empty slot instead, under the
 * description and at the top of the showtimes section, in a parent that gives it
 * a fixed height to lay out within. That is only safe because the panel there is
 * never up for a pull-to-refresh — which is the one thing an overlay protects
 * against, per the warning above.
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
