/**
 * A live count of the blocking surfaces on screen — the sheets and modals the
 * layout-level providers own (the showtime sheet, the filters and cinema
 * sheets, the notification centre).
 *
 * It exists for anything that has to be the *only* thing in front of the user
 * rather than merely on top: the intro's filters highlight dims the whole
 * screen and points at one button, which reads as nonsense over an open sheet,
 * so it waits until nothing else is up (see `IntroFiltersSpotlight`).
 *
 * A count rather than a boolean, so two surfaces open at once (a sheet with a
 * dialog over it) can each register and unregister independently.
 *
 * Same module-level store with subscribers as `theme-preference.ts` and
 * `feature-tips.ts`, so a provider can declare itself without every consumer
 * needing yet another context.
 */
import { useEffect, useState } from "react";

let openOverlayCount = 0;

const subscribers = new Set<() => void>();

const notify = (): void => {
  subscribers.forEach((subscriber) => subscriber());
};

/**
 * Declare a blocking surface. Call it unconditionally from the component that
 * owns the surface's visibility, passing whether it is currently open.
 */
export function useRegisterBlockingOverlay(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    openOverlayCount += 1;
    notify();
    return () => {
      openOverlayCount -= 1;
      notify();
    };
  }, [isOpen]);
}

/** True while any registered surface is open. */
export function useIsAnyBlockingOverlayOpen(): boolean {
  const [isOpen, setIsOpen] = useState(() => openOverlayCount > 0);

  useEffect(() => {
    const subscriber = () => setIsOpen(openOverlayCount > 0);
    subscribers.add(subscriber);
    // A surface can open between this component's render and its subscribe.
    subscriber();
    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  return isOpen;
}
