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
import { BackHandler, StyleSheet } from "react-native";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  type BottomSheetModalProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColors } from "@/hooks/use-theme-color";
import BottomSheetHeader from "@/components/sheets/BottomSheetHeader";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

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
  /** Backdrop press behavior; defaults to "close". Use "none" to lock the sheet. */
  backdropPressBehavior?: "close" | "none";
  keyboardBehavior?: BottomSheetModalProps["keyboardBehavior"];
  children: ReactNode;
};

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
      bottomSheetModalRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (handleAndroidBack) return handleAndroidBack();
      (onBack ?? onClose)();
      return true;
    });
    return () => sub.remove();
  }, [visible, onBack, onClose, handleAndroidBack]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.45}
        pressBehavior={backdropPressBehavior}
      />
    ),
    [backdropPressBehavior]
  );

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      snapPoints={resolvedSnapPoints}
      enablePanDownToClose={enablePanDownToClose}
      enableDismissOnClose={false}
      enableDynamicSizing={false}
      stackBehavior="push"
      keyboardBehavior={keyboardBehavior}
      animationConfigs={{ duration: 220 }}
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
