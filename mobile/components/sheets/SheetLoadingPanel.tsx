/**
 * What a bottom sheet shows in place of its content while it is still rising,
 * and for as long after that as its own data is missing.
 *
 * Every sheet in the app puts this up, so that every sheet answers a tap
 * identically: the sheet itself moves immediately and always at the same
 * speed, and whatever it is going to hold arrives into a sheet that is already
 * there. This is the price of that, and it is worth paying — six attempts at
 * making it appear less often are listed in {@link ./AppBottomSheet}, and every
 * one of them was noticed more than the panel is.
 *
 * Painted outright, never faded in. It goes up in the same commit that asks
 * the sheet to rise, so a fade over it is a fade running *during* the rise —
 * which on Android showed the sheet coming up visibly empty and filling in
 * halfway through its own animation. It leaves via {@link ./SheetContentFade}
 * instead, where a fade costs nothing because the sheet is already still.
 *
 * Whole sheet, never part of one. A sheet that shows some of itself while the
 * rest loads shows whatever it was given *last* in that part, because the body
 * renders from the previous props until the new ones commit.
 */
import { StyleSheet } from "react-native";

import LoadingLogo from "@/components/layout/LoadingLogo";
import { useThemeColors } from "@/hooks/use-theme-color";

/** Smaller than the full-screen curtain's logo: this sits inside a sheet. */
const SHEET_LOADING_LOGO_SIZE = 96;

export default function SheetLoadingPanel({
  label,
  onLayout,
}: {
  label?: string;
  /**
   * Fired once this is measured, i.e. once it is genuinely on screen. The sheet
   * waits for it before rising — see `useSheetPanelReady` for why that is not
   * automatic.
   */
  onLayout?: () => void;
}) {
  const colors = useThemeColors();

  return (
    <LoadingLogo
      style={styles.container}
      label={label}
      tintColor={colors.tint}
      labelColor={colors.textSecondary}
      logoSize={SHEET_LOADING_LOGO_SIZE}
      onLayout={onLayout}
    />
  );
}

const styles = StyleSheet.create({
  // Near the top rather than centred: a sheet is 88% of the screen, so its
  // middle is most of a phone's height below the thumb that opened it. Sitting
  // up here it lands roughly where the content it stands in for begins, and
  // reads as the sheet filling from the top rather than as one thing floating
  // in an empty one.
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 12,
    paddingTop: 64,
    paddingHorizontal: 40,
    paddingBottom: 40,
  },
});
