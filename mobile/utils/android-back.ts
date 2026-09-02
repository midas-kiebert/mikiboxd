/**
 * Who gets Android's back press, decided by what opened last.
 *
 * React Native calls its `hardwareBackPress` subscribers in reverse
 * registration order, and *re-registering moves a subscriber to the front of
 * that queue*. Every sheet re-subscribes whenever the callbacks it closes over
 * change identity, so the winner was really "whoever last re-rendered": with
 * the cinema sheet open on top of the Filters sheet, opening the cinema sheet
 * re-rendered the provider, Filters re-subscribed in that same commit, and
 * back closed the sheet *behind* the one the user was looking at.
 *
 * So order is taken out of React's hands. Each surface is stamped with a
 * sequence number when it opens and keeps it for as long as it stays open, a
 * single RN subscription fans the press out to the highest number first, and
 * the handler itself is read through a ref — a re-render can never reorder
 * anything.
 *
 * The RN subscription is dropped as soon as the last surface closes, so it is
 * always re-added *after* whatever else (react-navigation) subscribed while
 * nothing was up, and an open surface therefore still beats navigation.
 *
 * Android only in effect; `BackHandler` is inert on iOS.
 */
import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

/** Return true if the press was consumed, false to pass it down. */
type AndroidBackHandler = () => boolean;

type Registration = { order: number; handle: AndroidBackHandler };

const registrations = new Set<Registration>();
let nextOrder = 0;
// `ReturnType` rather than RN's `NativeEventSubscription`, which the package's
// root types do not re-export.
let subscription: ReturnType<typeof BackHandler.addEventListener> | null = null;

const handleBackPress = (): boolean => {
  const topFirst = Array.from(registrations).sort((left, right) => right.order - left.order);
  for (const registration of topFirst) {
    if (registration.handle()) return true;
  }
  return false;
};

/**
 * Take Android back presses while `active`, topmost surface first.
 *
 * Call it unconditionally; `handler` may be a fresh closure every render.
 */
export function useAndroidBackHandler(active: boolean, handler: AndroidBackHandler): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!active) return;
    const registration: Registration = { order: nextOrder++, handle: () => handlerRef.current() };
    registrations.add(registration);
    if (!subscription) {
      subscription = BackHandler.addEventListener("hardwareBackPress", handleBackPress);
    }
    return () => {
      registrations.delete(registration);
      if (registrations.size === 0) {
        subscription?.remove();
        subscription = null;
      }
    };
  }, [active]);
}
