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
import { useEffect, useState, type RefObject } from "react";
import { Modal, type View } from "react-native";

import SpotlightOverlay, { type SpotlightRect } from "@/components/intro/SpotlightOverlay";
import { endIntro } from "@/utils/intro";

/**
 * The screen behind has just finished loading its list; give it a moment to
 * settle before measuring, so the button is not caught mid-layout.
 */
const MEASURE_DELAY_MS = 600;

/**
 * The filters open in a bottom sheet, which lives under this overlay's window —
 * so the overlay has to be gone before the sheet is asked to present, or it
 * would rise behind it.
 */
const FILTERS_HANDOFF_DELAY_MS = 250;

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

  useEffect(() => {
    const timer = setTimeout(() => {
      targetRef.current?.measureInWindow((x, y, width, height) => {
        setTargetRect({ x, y, width, height });
      });
    }, MEASURE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [targetRef]);

  const handleOpenFilters = () => {
    endIntro();
    setTimeout(onOpenFilters, FILTERS_HANDOFF_DELAY_MS);
  };

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
