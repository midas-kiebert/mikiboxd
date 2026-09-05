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
 *  - a node built once and kept, so every open animates in a single frame
 *    (see `./sheet-warm-up`)
 *  - the same instant answer to a tap: the sheet rises holding
 *    {@link ./SheetLoadingPanel}, and the caller's content is built once it is
 *    up (see `deferContent` and `contentReady`), so every sheet answers at the
 *    same speed whatever it is about to hold
 *
 * Driven by a controlled `visible` prop (present/close mechanics mirror
 * ShowtimeActionModal). Callers render their own BottomSheetScrollView /
 * BottomSheetFlatList as children so the whole sheet is draggable.
 *
 * ## Five things that were tried here and are worse
 *
 * All of them chased the same complaint — a loading logo flashing on an open
 * fast enough not to need one — and every one of them traded it for something
 * users noticed more. Read this before reopening the question.
 *
 * 1. Stretching the panel's fade to cover the gate. Still flashed.
 * 2. Holding the panel behind a delay longer than the gate. Left the sheet
 *    *visibly empty* instead, which reads as broken rather than slow.
 * 3. Latching the gate so only a sheet's first open paid it. Fixed repeat
 *    opens; every sheet's first open still showed a logo it did not need.
 * 4. Measuring the body's build and gating only devices that overran a budget.
 *    Behaviour that differs by device cannot be reproduced or reasoned about,
 *    and the first open on a slow phone was still slow — the verdict has to
 *    come from *some* build.
 * 5. Splitting a sheet so its cheap header rose immediately and only the
 *    expensive part was gated. Flashed the **previously opened** item on every
 *    open: a body renders from the props it last had, and @gorhom/portal
 *    commits sheet content a render late, so anything kept across an open is
 *    stale for a frame or two.
 *
 * 6. Inverting the order outright — build the body first, `present()` after a
 *    50ms drain. On paper it removes the panel entirely; in practice it put
 *    the build *in front of* the animation and took tap→rise on a current
 *    iPhone from 98ms to **320ms**, with tap→present alone at 216ms.
 *
 * The last one is the rule the other five were circling, so state it plainly:
 * **nothing may be added between the tap and the rise.** tap→rise is the only
 * number a user can feel; everything after it is negotiable and everything
 * before it is not. A sheet that is up and still filling reads as fast. A
 * sheet that has not moved reads as broken, however complete it is when it
 * finally arrives. The panel is the price of that and it is worth paying.
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
import SheetContentFade from "@/components/sheets/SheetContentFade";
import SheetLoadingPanel from "@/components/sheets/SheetLoadingPanel";
import {
  useSheetContentReady,
  useSheetPanelReady,
} from "@/components/sheets/use-sheet-content-ready";
import { useSheetWarmUp } from "@/components/sheets/sheet-warm-up";
import { SHEET_OPEN_DURATION_MS } from "@/components/sheets/sheet-timing";

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
  /**
   * Whether the caller's data is in. False puts the loading panel up and keeps
   * it up past the sheet's arrival, so a sheet that has to fetch before it can
   * show anything still opens at the same speed as every other one. Defaults
   * to true, for content that only ever renders from what it already has.
   */
  contentReady?: boolean;
  /**
   * Whether to hold the content back until the sheet has finished rising.
   *
   * On by default, and it should stay on: gorhom builds a sheet's children
   * before it starts to move, so content mounted on open is paid for *inside*
   * the tap-to-motion gap. Turn it off only for a sheet whose content is a
   * handful of views and has to be live the instant it lands — one with an
   * `autoFocus` input, where a late mount is a late keyboard.
   */
  deferContent?: boolean;
  /** The line under the loading panel's spinner, e.g. "Loading cinemas…". */
  loadingLabel?: string;
  /**
   * Build this sheet's node at startup instead of on its first open — see
   * {@link ./sheet-warm-up}. Required for any sheet that must draw *in front
   * of* another one, since warm-up order is what fixes z-order now that none of
   * them rebuild themselves. The order is the order these components mount, so
   * moving one in its parent's JSX moves it in the stack.
   */
  warmUpOnMount?: boolean;
  /** Backdrop press behavior; defaults to "close". Use "none" to lock the sheet. */
  backdropPressBehavior?: "close" | "none";
  keyboardBehavior?: BottomSheetModalProps["keyboardBehavior"];
  children: ReactNode;
};

const SHEET_ANIMATION_CONFIG = { duration: SHEET_OPEN_DURATION_MS } as const;

/** The warm-up's open and close, which nobody is meant to see. */
const INSTANT_ANIMATION_CONFIG = { duration: 1 } as const;

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
  contentReady = true,
  loadingLabel,
  deferContent = true,
  warmUpOnMount = false,
  backdropPressBehavior = "close",
  keyboardBehavior,
  children,
}: AppBottomSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { top: topInset } = useSafeAreaInsets();

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const resolvedSnapPoints = useMemo(() => snapPoints ?? ["88%"], [snapPoints]);

  // A present-and-close at startup, so the sheet's node exists before anyone
  // taps. Everything below keeps it invisible and instantaneous while it runs,
  // and ignores the open and close it produces.
  const { isWarmingUp, onSheetChange: onWarmUpSheetChange } = useSheetWarmUp(
    bottomSheetModalRef,
    warmUpOnMount
  );

  // False until the sheet has finished rising, and past that for as long as the
  // caller's own fetch is still out — the sheet moves first and is filled
  // second, always in that order.
  const isContentReady = useSheetContentReady(visible);
  const isContentShown = contentReady && (isContentReady || !deferContent);
  // Whatever the sheet is not showing content for, it shows this instead. The
  // two are exact opposites, which is what makes an empty open impossible.
  const isLoadingPanelShown = visible && !isContentShown;
  // The sheet does not move until the panel it is going to rise holding is
  // actually on screen — gorhom's portal commits children a render late, so it
  // otherwise starts empty and catches up mid-animation.
  const { isPanelReady, onPanelLayout } = useSheetPanelReady(visible);

  // Drive the gorhom sheet imperatively from the controlled `visible` prop.
  const hasEverPresentedRef = useRef(false);
  const closedByGorhomRef = useRef(false);
  // Read from `handleSheetChange`, which gorhom holds by identity — a ref so
  // the warm-up ending does not hand it a new callback.
  const isWarmingUpRef = useRef(isWarmingUp);
  useEffect(() => {
    isWarmingUpRef.current = isWarmingUp;
  });

  const handleSheetChange = useCallback(
    (index: number) => {
      // The warm-up's own open and close are not the user's: they drive it to
      // completion and must not reach `onClose`.
      if (isWarmingUpRef.current) {
        onWarmUpSheetChange(index);
        return;
      }
      if (index === -1) {
        closedByGorhomRef.current = true;
        onClose();
      }
    },
    [onClose, onWarmUpSheetChange]
  );

  // `close()` rather than `dismiss()`: dismiss would unmount the node and hand
  // the next open the slow path again.
  useEffect(() => {
    // A tap that lands during the warm-up must not race it: presenting here
    // would only be closed again a frame later. The warm-up ending re-runs this
    // effect, which then opens the sheet for real.
    if (isWarmingUp) return;
    if (visible) {
      // Not yet: the panel has not been laid out, so the sheet would rise
      // showing nothing at all.
      if (!isPanelReady) return;
      hasEverPresentedRef.current = true;
      closedByGorhomRef.current = false;
      bottomSheetModalRef.current?.present();
    } else if (hasEverPresentedRef.current && !closedByGorhomRef.current) {
      bottomSheetModalRef.current?.close();
    }
  }, [visible, isPanelReady, isWarmingUp]);

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
      // Never: a sheet's node is built once — at startup if it is warmed, on
      // first open otherwise — and kept, because rebuilding it is the single
      // biggest cost an open can carry. See `./sheet-warm-up`.
      enableDismissOnClose={false}
      enableDynamicSizing={false}
      stackBehavior="push"
      keyboardBehavior={keyboardBehavior}
      animationConfigs={isWarmingUp ? INSTANT_ANIMATION_CONFIG : SHEET_ANIMATION_CONFIG}
      // `containerStyle`, not `style`: gorhom composes its own animated style
      // *after* the `style` prop and hard-sets `opacity: 1` on it whenever the
      // sheet is not at index -1 (BottomSheetBody), so `style` cannot hide a
      // sheet that is open — which is exactly what a warm-up is. The hosting
      // container above it composes the provided style first and never touches
      // opacity, so this one holds.
      containerStyle={isWarmingUp ? styles.warmingUp : undefined}
      backdropComponent={isWarmingUp ? undefined : renderBackdrop}
      backgroundStyle={[styles.sheetBackground, backgroundColor ? { backgroundColor } : null]}
      handleIndicatorStyle={styles.handleIndicator}
      topInset={topInset}
      onChange={handleSheetChange}
    >
      <BottomSheetHeader title={title} onClose={onClose} onBack={onBack} right={headerRight} />
      {/* Content once the sheet is up and its data is in — cross-faded in over
          the panel it replaces, since by then the sheet is still and a hard cut
          is the only thing moving. The panel alone while the sheet is open
          without it, and nothing at all while it is closed: a panel left in a
          closed sheet would be a looping animation and a logo bitmap per sheet,
          forever. */}
      {isContentShown ? (
        <SheetContentFade label={loadingLabel}>{children}</SheetContentFade>
      ) : isLoadingPanelShown ? (
        <SheetLoadingPanel label={loadingLabel} onLayout={onPanelLayout} />
      ) : null}
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
    // The warm-up: mounted and laid out, but neither on screen nor able to
    // take a touch — it covers most of the screen while it runs, and it runs
    // during startup, which is exactly when someone is already tapping.
    warmingUp: { opacity: 0, pointerEvents: "none" },
  });
