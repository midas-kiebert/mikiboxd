/**
 * What a tab shows for the moment between being pressed and being built.
 *
 * A tab screen is mounted the first time you open it, and React renders the
 * whole thing before anything is committed — so the *old* screen stayed on
 * display for as long as the new one took to build, and the press looked
 * ignored. This is the shell that goes up instead, immediately: the same top
 * bar the screen will have, and the app's loading panel under it.
 *
 * Deliberately thin. Everything on it has to be cheap enough to draw in the
 * frame the tab is pressed, which rules out anything that reads state.
 *
 * The panel rather than rows of bones: a tab's content is a different shape on
 * every tab (feed cards, friend rows, settings groups), so a row shell could
 * only ever be right for one of them, and being wrong about the shape is worse
 * than not claiming one — the content arriving reads as a correction. The
 * panel promises nothing about layout and is the same wait the rest of the app
 * shows. It fades in (see LoadingLogo), so a tab that builds quickly — most of
 * them — shows next to nothing rather than a blink of logo.
 */
import { StyleSheet, View } from "react-native";

import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import TopBar from "@/components/layout/TopBar";
import ListLoadingLogo from "@/components/layout/ListLoadingLogo";
import { useThemeColors } from "@/hooks/use-theme-color";
import type { IconSymbolName } from "@/components/ui/icon-symbol";

export default function TabScreenSkeleton({
  title,
  icon,
}: {
  title?: string;
  icon?: IconSymbolName;
}) {
  const colors = useThemeColors();

  return (
    <TopSafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar title={title} icon={icon} />
      <View style={styles.body}>
        <ListLoadingLogo />
      </View>
    </TopSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Fills what's left under the top bar, so the panel centres in the space the
  // content will occupy rather than against the bar.
  body: { flex: 1 },
});
