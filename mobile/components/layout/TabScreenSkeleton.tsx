/**
 * What a tab shows for the moment between being pressed and being built.
 *
 * A tab screen is mounted the first time you open it, and React renders the
 * whole thing before anything is committed — so the *old* screen stayed on
 * display for as long as the new one took to build, and the press looked
 * ignored. This is the shell that goes up instead, immediately: the same top
 * bar the screen will have, and rows where its content will be.
 *
 * Deliberately thin. Everything on it has to be cheap enough to draw in the
 * frame the tab is pressed, which rules out anything that reads state, and it
 * has to leave the screen in roughly the shape it will take, or the content
 * arriving reads as a second jump.
 */
import { StyleSheet, View } from "react-native";

import TopSafeAreaView from "@/components/layout/TopSafeAreaView";
import TopBar from "@/components/layout/TopBar";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useThemeColors } from "@/hooks/use-theme-color";
import type { IconSymbolName } from "@/components/ui/icon-symbol";

export default function TabScreenSkeleton({
  title,
  icon,
  rowHeight = 112,
}: {
  title?: string;
  icon?: IconSymbolName;
  /** Matched to the rows the screen actually has, so nothing resizes later. */
  rowHeight?: number;
}) {
  const colors = useThemeColors();

  return (
    <TopSafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <TopBar title={title} icon={icon} />
      <View style={styles.rows}>
        <SkeletonRows height={rowHeight} />
      </View>
    </TopSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // The feeds' own padding, so the rows land where the cards will.
  rows: { paddingTop: 12, paddingHorizontal: 16 },
});
