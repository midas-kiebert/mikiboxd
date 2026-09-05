/**
 * The first-run walkthrough: five full-screen pages, a progress row, and one
 * "Skip tutorial" escape hatch that is always reachable.
 *
 * One Modal for all of them, opaque for the pages that own the screen and
 * transparent for the showtime tour, which has to show the real sheet behind
 * it. The sheet itself is rendered as a sibling of the Modal rather than inside
 * it — see `IntroShowtimeSheet` — and stays mounted for the whole intro so
 * entering and leaving the tour page is a sheet animation rather than a mount.
 *
 * Which page is on screen lives here; what each page does lives in the page.
 * The final filters highlight is not part of this flow at all: it belongs to
 * the showtimes screen, which is the only thing that knows when its list is up
 * (see `IntroFiltersSpotlight`).
 *
 * The Modal takes the screen instantly (`animationType="none"`) and animates its
 * *contents* in instead. Fading the window itself meant whatever it was covering
 * — the splash on a cold start, the login screen sliding away to the tabs after
 * a sign-up — was visible through it for the length of the fade. Leaving is the
 * opposite case and does fade, since by then the app underneath is what the user
 * is meant to be looking at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import IntroCinemasPage from "@/components/intro/IntroCinemasPage";
import IntroFriendsPage from "@/components/intro/IntroFriendsPage";
import IntroLetterboxdPage from "@/components/intro/IntroLetterboxdPage";
import IntroNotificationsPage from "@/components/intro/IntroNotificationsPage";
import IntroShowtimeSheet from "@/components/intro/IntroShowtimeSheet";
import IntroShowtimeTour, { SHOWTIME_TOUR_STEPS } from "@/components/intro/IntroShowtimeTour";
import type { SpotlightRect } from "@/components/intro/SpotlightOverlay";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { closeAllBlockingOverlays } from "@/utils/blocking-overlays";
import { completeIntroPages, endIntro, INTRO_PAGE_ORDER } from "@/utils/intro";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

/** Space above and below the progress/skip row, on top of the safe area. */
const CHROME_VERTICAL_PADDING = 12;

/** The contents settling in once the Modal has taken the screen. */
const ENTRANCE_DURATION_MS = 280;
/** Leaving the current page. Short: this is the response to a tap. */
const PAGE_EXIT_MS = 130;
/** The next page arriving. Longer than the exit so it reads as a settle. */
const PAGE_ENTER_MS = 220;
/** How far a page slides as it changes, in points. Enough to suggest forward motion. */
const PAGE_SHIFT = 14;
/** The whole walkthrough fading out to reveal the app behind it. */
const EXIT_DURATION_MS = 240;

export default function IntroFlow() {
  // Read flow: local state first, then the handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();

  const [pageIndex, setPageIndex] = useState(0);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  // Cleared on every step change: a hole left over from the previous target
  // would be pointing at the wrong button until the new measurement lands.
  const [tourTargetRect, setTourTargetRect] = useState<SpotlightRect | null>(null);

  const layerOpacity = useAnimatedValue(1);
  const chromeOpacity = useAnimatedValue(0);
  // The first page is painted outright, not faded in. The Modal takes the
  // screen instantly and fills it with `containerOpaque`, so a page starting at
  // zero meant a beat of bare background before anything appeared — read as the
  // walkthrough flashing up, vanishing and coming back. Only the page *changes*
  // below are animated; `hasEnteredRef` is what tells the two apart.
  const pageOpacity = useAnimatedValue(1);
  const pageShift = useAnimatedValue(0);
  const hasEnteredRef = useRef(false);
  // Guards the exit against a second tap landing mid-fade.
  const isLeavingRef = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const pageId = INTRO_PAGE_ORDER[pageIndex];
  const isTourPage = pageId === "showtime-tour";

  useEffect(() => {
    // The walkthrough takes over the whole screen, so anything already open is
    // closed rather than covered — a filters sheet left up before the intro
    // started (or before a replay from Settings) would otherwise still be
    // sitting there when it ended, underneath the highlight that is supposed to
    // be telling the user to open it.
    closeAllBlockingOverlays();
  }, []);

  useEffect(() => {
    // The window is already opaque; this is only its chrome arriving.
    const entrance = Animated.timing(chromeOpacity, {
      toValue: 1,
      duration: ENTRANCE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    entrance.start();
    return () => entrance.stop();
  }, [chromeOpacity]);

  useEffect(() => {
    // Runs after the commit that put this page on screen — which is the whole
    // point of it being an effect rather than the tail of the exit animation's
    // callback. Started from there, the fade-in ran against the page that was
    // still mounted, so the *previous* page visibly faded back in for a frame or
    // two before React swapped in the new one. That was the flash.
    if (!hasEnteredRef.current) {
      // First page: already at rest (see the refs above). There is nothing to
      // transition *from*, and animating anyway is what made entering the
      // walkthrough flicker.
      hasEnteredRef.current = true;
      return;
    }
    pageOpacity.setValue(0);
    pageShift.setValue(PAGE_SHIFT);
    const enter = Animated.parallel([
      Animated.timing(pageOpacity, {
        toValue: 1,
        duration: PAGE_ENTER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pageShift, {
        toValue: 0,
        duration: PAGE_ENTER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    enter.start();
    return () => enter.stop();
  }, [pageIndex, pageOpacity, pageShift]);

  /** Fades the current page out, then hands the swap to the effect above. */
  const transitionToPage = useCallback(
    (applyChange: () => void) => {
      Animated.parallel([
        Animated.timing(pageOpacity, {
          toValue: 0,
          duration: PAGE_EXIT_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pageShift, {
          toValue: -PAGE_SHIFT,
          duration: PAGE_EXIT_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        applyChange();
      });
    },
    [pageOpacity, pageShift]
  );

  /** Fades the whole walkthrough out, then hands over to whatever comes next. */
  const leaveIntro = useCallback(
    (finish: () => void) => {
      if (isLeavingRef.current) return;
      isLeavingRef.current = true;
      setIsLeaving(true);
      Animated.timing(layerOpacity, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => finish());
    },
    [layerOpacity]
  );

  const handleNextPage = useCallback(() => {
    if (pageIndex >= INTRO_PAGE_ORDER.length - 1) {
      // Last page done: the showtimes screen owes the filters highlight.
      leaveIntro(completeIntroPages);
      return;
    }
    transitionToPage(() => setPageIndex(pageIndex + 1));
  }, [leaveIntro, pageIndex, transitionToPage]);

  const handleSkip = useCallback(() => {
    triggerSelectionHaptic();
    leaveIntro(endIntro);
  }, [leaveIntro]);

  const handleNextTourStep = useCallback(() => {
    if (tourStepIndex >= SHOWTIME_TOUR_STEPS.length - 1) {
      handleNextPage();
      return;
    }
    setTourTargetRect(null);
    setTourStepIndex(tourStepIndex + 1);
  }, [handleNextPage, tourStepIndex]);

  const tour = useMemo(
    () => ({
      target: SHOWTIME_TOUR_STEPS[tourStepIndex].target,
      onTargetRect: setTourTargetRect,
    }),
    [tourStepIndex]
  );

  // Render/output using the state and handlers prepared above.
  return (
    <>
      {/* Outside the Modal below, which is a window above it. */}
      <IntroShowtimeSheet visible={isTourPage && !isLeaving} tour={tour} />

      <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={handleSkip}>
        {/* No padding of its own: the spotlight below is positioned from
            window coordinates, so its coordinate space has to be the window. */}
        <Animated.View
          style={[
            styles.container,
            !isTourPage && styles.containerOpaque,
            { opacity: layerOpacity },
          ]}
          // Nothing is tappable once it has started leaving.
          pointerEvents={isLeaving ? "none" : "auto"}
        >
          {isTourPage ? (
            <IntroShowtimeTour
              stepIndex={tourStepIndex}
              targetRect={tourTargetRect}
              onNext={handleNextTourStep}
            />
          ) : null}

          {/* Last sibling on the tour page, so it paints and takes taps above
              the overlay's dim panes. */}
          <Animated.View
            style={[
              styles.chrome,
              { paddingTop: insets.top + CHROME_VERTICAL_PADDING, opacity: chromeOpacity },
            ]}
          >
            <View style={styles.progress}>
              {INTRO_PAGE_ORDER.map((id, index) => (
                <View
                  key={id}
                  style={[
                    styles.progressDot,
                    isTourPage && styles.progressDotOnDim,
                    index <= pageIndex && styles.progressDotActive,
                  ]}
                />
              ))}
            </View>
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              hitSlop={8}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <ThemedText style={[styles.skipLabel, isTourPage && styles.skipLabelOnDim]}>
                Skip tutorial
              </ThemedText>
            </TouchableOpacity>
          </Animated.View>

          {!isTourPage ? (
            <Animated.View
              style={[
                styles.page,
                {
                  paddingBottom: insets.bottom,
                  opacity: pageOpacity,
                  transform: [{ translateX: pageShift }],
                },
              ]}
            >
              {pageId === "cinemas" ? <IntroCinemasPage onDone={handleNextPage} /> : null}
              {pageId === "letterboxd" ? <IntroLetterboxdPage onDone={handleNextPage} /> : null}
              {pageId === "friends" ? <IntroFriendsPage onDone={handleNextPage} /> : null}
              {pageId === "notifications" ? (
                <IntroNotificationsPage onDone={handleNextPage} />
              ) : null}
            </Animated.View>
          ) : null}
        </Animated.View>
      </Modal>
    </>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    // The tour page is see-through so the sheet behind it shows; the other
    // three own the screen outright.
    containerOpaque: {
      backgroundColor: colors.background,
    },
    chrome: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingBottom: CHROME_VERTICAL_PADDING,
    },
    progress: {
      flexDirection: "row",
      gap: 6,
    },
    progressDot: {
      width: 16,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
    },
    progressDotActive: {
      backgroundColor: colors.tint,
    },
    // The tour page's chrome sits on the dimmed sheet, where theme greys are
    // barely visible in either colour scheme.
    progressDotOnDim: {
      backgroundColor: "rgba(255, 255, 255, 0.35)",
    },
    skipButton: {
      paddingVertical: 4,
      paddingHorizontal: 4,
    },
    skipLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    skipLabelOnDim: {
      color: "#ffffff",
    },
    page: {
      flex: 1,
    },
  });
