/**
 * Intro page 3 — the showtime sheet, explained.
 *
 * The sheet the user will spend most of their time in is not something a
 * screenshot explains well, so the tour opens the real one over invented data
 * (`demo-showtime.ts`) and walks a spotlight across its three buttons. The
 * sheet is inert throughout — the overlay sits in the intro's own Modal, which
 * is a window above it, so nothing in the sheet can be tapped by accident.
 *
 * This module is the script and the overlay; `IntroShowtimeSheet` is the sheet
 * it points at, and `IntroFlow` owns which step is showing (it has to, because
 * the sheet must be mounted outside the intro's Modal to be visible behind it).
 */
import type { ShowtimeSheetTourTarget } from "@/components/showtimes/ShowtimeActionModal";
import SpotlightOverlay, { type SpotlightRect } from "@/components/intro/SpotlightOverlay";

type ShowtimeTourStep = {
  target: ShowtimeSheetTourTarget;
  title: string;
  message: string;
};

export const SHOWTIME_TOUR_STEPS: readonly ShowtimeTourStep[] = [
  {
    target: "interested",
    title: "Mark a showtime as interested",
    message: "Your friends can see what you want to watch.",
  },
  {
    target: "going",
    title: "Going? Say so",
    message: "Mark a showtime as going once you have reserved a ticket.",
  },
  {
    target: "invite",
    title: "You can invite friends too",
    message: "Pick a friend and they get an invite for this exact showtime.",
  },
];

type IntroShowtimeTourProps = {
  stepIndex: number;
  /** Where the sheet says the current step's button is; null until measured. */
  targetRect: SpotlightRect | null;
  onNext: () => void;
};

export default function IntroShowtimeTour({
  stepIndex,
  targetRect,
  onNext,
}: IntroShowtimeTourProps) {
  const step = SHOWTIME_TOUR_STEPS[stepIndex];
  const isLastStep = stepIndex === SHOWTIME_TOUR_STEPS.length - 1;

  return (
    <SpotlightOverlay
      target={targetRect}
      // Pinned up top: the spotlight moves down the sheet from step to step,
      // and text that moved with it would be read three times over.
      captionPlacement="top"
      // One overlay serves all three steps, so it has to be told when the step
      // changed — otherwise only the first one animates in.
      stepKey={stepIndex}
      title={step.title}
      message={step.message}
      stepLabel={`${stepIndex + 1} of ${SHOWTIME_TOUR_STEPS.length}`}
      primaryLabel={isLastStep ? "Continue" : "Next"}
      onPrimary={onNext}
    />
  );
}
