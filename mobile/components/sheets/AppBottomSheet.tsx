/**
 * Shared bottom-sheet wrapper used by every app sheet so they all look and
 * behave the same:
 *  - gorhom BottomSheetModal with a drag handle ("little tab") on top
 *  - the shared {@link BottomSheetHeader} (title + close, optional back button)
 *  - a consistent dimmed backdrop that closes on press
 *  - pan-down-to-close and the same snap height (default 88%)
 *  - the Android hardware back button closes the sheet (or steps back when a
 *    back handler is supplied), matching the header's back button
 *  - stackBehavior="push" so nested sheets stack correctly
 *
 * Driven by a controlled `visible` prop (present/close mechanics mirror
 * ShowtimeActionModal). Callers render their own BottomSheetScrollView /
 * BottomSheetFlatList as children so the whole sheet is draggable.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  type BottomSheetModalProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColors } from "@/hooks/use-theme-color";
import { useAndroidBackHandler } from "@/utils/android-back";
import BottomSheetHeader from "@/components/sheets/BottomSheetHeader";
import SheetBackdrop from "@/components/sheets/SheetBackdrop";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

/**
 * How long every sheet takes to rise. Exported because content that is held
 * back until the sheet has arrived (see `use-sheet-content-ready`) has to know
 * how long "arrived" is.
 */
export const SHEET_OPEN_DURATION_MS = 220;

type AppBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Shows a header back button and makes it (and Android back) step back instead of closing. */
  onBack?: () => void;
  /**
   * Custom Android hardware-back handler. Return true if the press was consumed
   * (e.g. an internal page navigated back). Falls back to onBack ?? onClose.
   */
  handleAndroidBack?: () => boolean;
  /** Default ["88%"] so every sheet opens to the same height. */
  snapPoints?: string[];
  /** Sheet background; defaults to the theme background (nested sheets pass nestedModalBackground). */
  backgroundColor?: string;
  /** Optional element shown left of the close button in the header. */
  headerRight?: ReactNode;
  /** Defaults to true. Set false to temporarily lock the sheet (e.g. while saving). */
  enablePanDownToClose?: boolean;
  /**
   * Throw the sheet's content away when it closes instead of keeping it mounted.
   *
   * Needed by any sheet that can be opened *on top of* another one: @gorhom/portal
   * fixes a sheet's stacking slot the first time it mounts and never reshuffles it
   * (`addUpdatePortal` updates in place), so a sheet still mounted from an earlier
   * standalone visit draws *behind* the sheet it was opened from. Re-mounting on
   * every open appends it last, i.e. on top.
   *
   * The cost is a fresh render of the content on each open, so leave it off for
   * sheets with expensive content that are never nested.
   */
  dismissWhenClosed?: boolean;
  /** Backdrop press behavior; defaults to "close". Use "none" to lock the sheet. */
  backdropPressBehavior?: "close" | "none";
  keyboardBehavior?: BottomSheetModalProps["keyboardBehavior"];
  children: ReactNode;
};

const SHEET_ANIMATION_CONFIG = { duration: SHEET_OPEN_DURATION_MS } as const;

export default function AppBottomSheet({
  visible,
  onClose,
  title,
  onBack,
  handleAndroidBack,
  snapPoints,
  backgroundColor,
  headerRight,
  enablePanDownToClose = true,
  dismissWhenClosed = false,
  backdropPressBehavior = "close",
  keyboardBehavior,
  children,
}: AppBottomSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { top: topInset } = useSafeAreaInsets();

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const resolvedSnapPoints = useMemo(() => snapPoints ?? ["88%"], [snapPoints]);

  // Drive the gorhom sheet imperatively from the controlled `visible` prop.
  const hasEverPresentedRef = useRef(false);
  const closedByGorhomRef = useRef(false);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        closedByGorhomRef.current = true;
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (visible) {
      hasEverPresentedRef.current = true;
      closedByGorhomRef.current = false;
      bottomSheetModalRef.current?.present();
    } else if (hasEverPresentedRef.current && !closedByGorhomRef.current) {
      // dismiss() animates down like close() does, but also unmounts the node —
      // see `dismissWhenClosed`.
      if (dismissWhenClosed) {
        bottomSheetModalRef.current?.dismiss();
      } else {
        bottomSheetModalRef.current?.close();
      }
    }
  }, [visible, dismissWhenClosed]);

  // Through the shared stack, not `BackHandler` directly: a sheet opened on top
  // of another one has to win the press, and RN's own ordering hands it to
  // whichever sheet re-subscribed last — see `utils/android-back.ts`.
  useAndroidBackHandler(visible, () => {
    if (handleAndroidBack) return handleAndroidBack();
    (onBack ?? onClose)();
    return true;
  });

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} pressBehavior={backdropPressBehavior} />
    ),
    [backdropPressBehavior]
  );

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      snapPoints={resolvedSnapPoints}
      enablePanDownToClose={enablePanDownToClose}
      // Swipe-down and backdrop presses close the sheet without going through
      // the effect above, so they need the same unmount to keep the node's
      // stacking slot fresh.
      enableDismissOnClose={dismissWhenClosed}
      enableDynamicSizing={false}
      stackBehavior="push"
      keyboardBehavior={keyboardBehavior}
      animationConfigs={SHEET_ANIMATION_CONFIG}
      backdropComponent={renderBackdrop}
      backgroundStyle={[styles.sheetBackground, backgroundColor ? { backgroundColor } : null]}
      handleIndicatorStyle={styles.handleIndicator}
      topInset={topInset}
      onChange={handleSheetChange}
    >
      <BottomSheetHeader title={title} onClose={onClose} onBack={onBack} right={headerRight} />
      {children}
    </BottomSheetModal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 36,
      height: 4,
    },
  });
