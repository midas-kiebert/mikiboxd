/**
 * The intro's last step: one highlight over the Filters button, once the user
 * is actually looking at a loaded list of showtimes.
 *
 * Not part of `IntroFlow` on purpose — it points at a real control on a real
 * screen, so it has to wait for that screen rather than for a page turn. The
 * showtimes screen renders it when its list is up and the intro's pages are
 * behind it (`IntroPhase` is `filters-spotlight`).
 *
 * Unlike the showtime tour, the highlighted control here is real: tapping it
 * opens the filters for real, which is the whole point of pointing at it.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { Modal, type View } from "react-native";

import SpotlightOverlay, { type SpotlightRect } from "@/components/intro/SpotlightOverlay";
import { closeAllBlockingOverlays } from "@/utils/blocking-overlays";
import { endIntro, markFiltersSpotlightStarted } from "@/utils/intro";
import { measureForSpotlight } from "@/utils/spotlight-measure";

/**
 * The screen behind has just finished loading its list; give it a moment to
 * settle before measuring, so the button is not caught mid-layout. Short
 * enough that the highlight still feels immediate.
 */
const MEASURE_DELAY_MS = 300;

/**
 * The filters open in a bottom sheet, which lives under this overlay's window —
 * so the overlay has to be gone before the sheet is asked to present, or it
 * would rise behind it.
 */
const FILTERS_HANDOFF_DELAY_MS = 250;

/**
 * If the Filters button cannot be measured at all (it has gone, or the screen
 * re-laid out under us), there is nothing to point at and no step to show —
 * so the intro is ended rather than left parked in its last phase forever.
 */
const MEASURE_TIMEOUT_MS = 1200;

type IntroFiltersSpotlightProps = {
  /** The Filters pill on the showtimes screen. */
  targetRef: RefObject<View | null>;
  /** Runs when the user takes the suggestion, instead of just acknowledging it. */
  onOpenFilters: () => void;
};

export default function IntroFiltersSpotlight({
  targetRef,
  onOpenFilters,
}: IntroFiltersSpotlightProps) {
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const targetRectRef = useRef<SpotlightRect | null>(null);

  useEffect(() => {
    // Belt-and-braces: the showtimes screen already withholds this component
    // until nothing is registered as open (see `isShowingIntroFiltersSpotlight`
    // in app/(tabs)/index.tsx), but that only covers overlays that announce
    // themselves. Closing again here catches anything that slipped past that
    // check or opened in the gap between the check passing and this mounting —
    // this step must never appear over another modal.
    closeAllBlockingOverlays();
  }, []);

  useEffect(() => {
    // This step is happening after all, so the intro stops waiting on the
    // clock for it; the timers below own the ending from here.
    markFiltersSpotlightStarted();
  }, []);

  useEffect(() => {
    const measureTimer = setTimeout(() => {
      measureForSpotlight(targetRef.current, (rect) => {
        targetRectRef.current = rect;
        setTargetRect(rect);
      });
    }, MEASURE_DELAY_MS);
    const timeoutTimer = setTimeout(() => {
      if (targetRectRef.current) return;
      endIntro();
    }, MEASURE_DELAY_MS + MEASURE_TIMEOUT_MS);
    return () => {
      clearTimeout(measureTimer);
      clearTimeout(timeoutTimer);
    };
  }, [targetRef]);

  const handleOpenFilters = () => {
    endIntro();
    setTimeout(onOpenFilters, FILTERS_HANDOFF_DELAY_MS);
  };

  // Nothing is shown until the button has been found. Presenting first and
  // measuring after meant the caption rendered pinned to the top of the screen
  // (its fallback when there is no hole to sit beside) and then jumped down to
  // the button once the measurement landed, a frame or two later.
  if (!targetRect) return null;

  return (
    // A window of its own: the highlight has to cover the tab bar too, which a
    // view inside the screen cannot.
    <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={endIntro}>
      <SpotlightOverlay
        target={targetRect}
        title="Try out some filters!"
        message="Only show showtimes your friends have marked, on certain days, at certain times, from your favorite Letterboxd lists etc."
        primaryLabel="Open filters"
        onPrimary={handleOpenFilters}
        secondaryLabel="Not now"
        onSecondary={endIntro}
        onPressTarget={handleOpenFilters}
      />
    </Modal>
  );
}
