/**
 * The first-run walkthrough: four full-screen pages, a progress row, and one
 * "Skip tutorial" escape hatch that is always reachable.
 *
 * One Modal for all four pages, opaque for the three that own the screen and
 * transparent for the showtime tour, which has to show the real sheet behind
 * it. The sheet itself is rendered as a sibling of the Modal rather than inside
 * it — see `IntroShowtimeSheet` — and stays mounted for the whole intro so
 * entering and leaving the tour page is a sheet animation rather than a mount.
 *
 * Which page is on screen lives here; what each page does lives in the page.
 * The final filters highlight is not part of this flow at all: it belongs to
 * the showtimes screen, which is the only thing that knows when its list is up
 * (see `IntroFiltersSpotlight`).
 */
import { useCallback, useMemo, useState } from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import IntroCinemasPage from "@/components/intro/IntroCinemasPage";
import IntroFriendsPage from "@/components/intro/IntroFriendsPage";
import IntroLetterboxdPage from "@/components/intro/IntroLetterboxdPage";
import IntroShowtimeSheet from "@/components/intro/IntroShowtimeSheet";
import IntroShowtimeTour, { SHOWTIME_TOUR_STEPS } from "@/components/intro/IntroShowtimeTour";
import type { SpotlightRect } from "@/components/intro/SpotlightOverlay";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { completeIntroPages, endIntro, INTRO_PAGE_ORDER } from "@/utils/intro";
import { triggerSelectionHaptic } from "@/utils/long-press";

/** Space above and below the progress/skip row, on top of the safe area. */
const CHROME_VERTICAL_PADDING = 12;

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

  const pageId = INTRO_PAGE_ORDER[pageIndex];
  const isTourPage = pageId === "showtime-tour";

  const handleNextPage = useCallback(() => {
    if (pageIndex >= INTRO_PAGE_ORDER.length - 1) {
      // Last page done: the showtimes screen owes the filters highlight.
      completeIntroPages();
      return;
    }
    setPageIndex(pageIndex + 1);
  }, [pageIndex]);

  const handleSkip = useCallback(() => {
    triggerSelectionHaptic();
    endIntro();
  }, []);

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
      <IntroShowtimeSheet visible={isTourPage} tour={tour} />

      <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={handleSkip}>
        {/* No padding of its own: the spotlight below is positioned from
            window coordinates, so its coordinate space has to be the window. */}
        <View style={[styles.container, !isTourPage && styles.containerOpaque]}>
          {isTourPage ? (
            <IntroShowtimeTour
              stepIndex={tourStepIndex}
              targetRect={tourTargetRect}
              onNext={handleNextTourStep}
            />
          ) : null}

          {/* Last sibling on the tour page, so it paints and takes taps above
              the overlay's dim panes. */}
          <View style={[styles.chrome, { paddingTop: insets.top + CHROME_VERTICAL_PADDING }]}>
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
          </View>

          {!isTourPage ? (
            <View style={[styles.page, { paddingBottom: insets.bottom }]}>
              {pageId === "cinemas" ? <IntroCinemasPage onDone={handleNextPage} /> : null}
              {pageId === "letterboxd" ? <IntroLetterboxdPage onDone={handleNextPage} /> : null}
              {pageId === "friends" ? <IntroFriendsPage onDone={handleNextPage} /> : null}
            </View>
          ) : null}
        </View>
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
      width: 22,
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
