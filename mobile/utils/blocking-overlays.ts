/**
 * A live registry of the blocking surfaces on screen — the sheets and modals the
 * layout-level providers own (the showtime sheet, the filters and cinema
 * sheets, the notification centre).
 *
 * It exists for anything that has to be the *only* thing in front of the user
 * rather than merely on top: the intro's filters highlight dims the whole
 * screen and points at one button, which reads as nonsense over an open sheet,
 * so it waits until nothing else is up (see `IntroFiltersSpotlight`).
 *
 * Each surface registers a way to close itself, not just the fact that it is
 * open, so the intro can *guarantee* a clear screen rather than wait and hope
 * for one — a sheet left open before the walkthrough started would otherwise
 * still be sitting there when it ended.
 *
 * A set rather than a count, so two surfaces open at once (a sheet with a
 * dialog over it) register and unregister independently.
 *
 * Same module-level store with subscribers as `theme-preference.ts` and
 * `feature-tips.ts`, so a provider can declare itself without every consumer
 * needing yet another context.
 */
import { useEffect, useRef, useState } from "react";

type BlockingOverlayRegistration = { close: () => void };

const registrations = new Set<BlockingOverlayRegistration>();

const subscribers = new Set<() => void>();

const notify = (): void => {
  subscribers.forEach((subscriber) => subscriber());
};

/**
 * Declare a blocking surface. Call it unconditionally from the component that
 * owns the surface's visibility, passing whether it is currently open and how
 * to close it.
 */
export function useRegisterBlockingOverlay(isOpen: boolean, close: () => void): void {
  // Read through a ref so a fresh closure each render does not re-register.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!isOpen) return;
    const registration = { close: () => closeRef.current() };
    registrations.add(registration);
    notify();
    return () => {
      registrations.delete(registration);
      notify();
    };
  }, [isOpen]);
}

/**
 * Close every open blocking surface. For anything that is about to take over the
 * whole screen and must not simply reveal what it was covering when it leaves.
 */
export function closeAllBlockingOverlays(): void {
  // Snapshot first: closing a surface unregisters it, which mutates the set.
  Array.from(registrations).forEach((registration) => registration.close());
}

/** True while any registered surface is open. */
export function useIsAnyBlockingOverlayOpen(): boolean {
  const [isOpen, setIsOpen] = useState(() => registrations.size > 0);

  useEffect(() => {
    const subscriber = () => setIsOpen(registrations.size > 0);
    subscribers.add(subscriber);
    // A surface can open between this component's render and its subscribe.
    subscriber();
    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  return isOpen;
}
