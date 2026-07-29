/**
 * Decides whether the first-run intro is on screen.
 *
 * Mounted once in the root layout, below the splash and above everything else,
 * because the intro covers the whole app — tab bar included — rather than one
 * screen. It only starts the walkthrough; the last step (the filters highlight)
 * belongs to the showtimes screen, which is the only thing that knows when its
 * list is up.
 *
 * It waits for the user to be in the tabs *and* to have a username before
 * starting: a social sign-in is authenticated while still on the "pick a
 * username" screen, and an intro over that would be covering a form the user
 * has to fill in — or, if a redirect race put the app in the tabs instead,
 * replacing it entirely, which is how accounts came to exist with no username
 * at all. Only the start is gated — once running, the intro stays put wherever
 * the app goes, which is exactly why it forces the showtimes tab the moment it
 * actually starts: a resumed deep link or another tab reached first would
 * otherwise be whatever's revealed once the walkthrough ends.
 */
import { useEffect, useState } from "react";
import { useNavigationContainerRef, useRouter, useSegments } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchCinemas } from "shared/hooks/useFetchCinemas";

import IntroFlow from "@/components/intro/IntroFlow";
import { hasUsername, useCurrentUser } from "@/hooks/useCurrentUser";
import {
  startIntroIfPending,
  useIntroPhase,
  useIsIntroLoaded,
  useIsIntroOwed,
} from "@/utils/intro";

const TABS_SEGMENT = "(tabs)";

export default function IntroHost() {
  const phase = useIntroPhase();
  const isLoaded = useIsIntroLoaded();
  const isOwed = useIsIntroOwed();
  const segments = useSegments();
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  const queryClient = useQueryClient();
  const isInTabs = (segments as unknown as string[])[0] === TABS_SEGMENT;
  // The walkthrough waits for a *confirmed* username, not merely for the
  // absence of a known-missing one: whatever else goes wrong, the intro can
  // then never be the thing a brand-new account sees instead of the username
  // form. Costs one already-in-flight round trip on a real signup.
  const currentUser = useCurrentUser();
  const hasPickedUsername = hasUsername(currentUser);

  // expo-router throws on any navigation until the root NavigationContainer
  // reports ready. That flag is set by an effect in ExpoRoot — an ancestor of
  // this component — and React flushes descendant effects before ancestor ones,
  // so on the first mount our redirect effect below would always run a beat too
  // early. Subscribing here re-runs it once the container is genuinely ready.
  // `useRootNavigationState().key` is not a substitute: it comes from the router
  // store, which is populated before the container mounts.
  const [isNavigationReady, setIsNavigationReady] = useState(
    () => navigationRef?.isReady() ?? false,
  );

  useEffect(() => {
    if (isNavigationReady) return;
    if (navigationRef?.isReady()) {
      setIsNavigationReady(true);
      return;
    }
    return navigationRef?.addListener("state", () => {
      if (navigationRef.isReady()) setIsNavigationReady(true);
    });
  }, [navigationRef, isNavigationReady]);

  useEffect(() => {
    // The walkthrough opens on a full-screen cinema picker. Fetching that list
    // when the page mounts meant the first thing a brand-new account saw was an
    // empty box that filled in a beat later, so it is pulled the moment we know
    // the intro is coming. A no-op when the root layout's startup warm-up
    // already has it; this covers the replay-from-Settings path and a sign-up
    // that reaches here before the warm-up did.
    if (!isOwed) return;
    void prefetchCinemas(queryClient);
  }, [isOwed, queryClient]);

  useEffect(() => {
    // A no-op unless an account was created on this device and never
    // introduced. Waits for the stored flag, which usually lands after mount.
    if (!isNavigationReady || !isLoaded || !isInTabs || !hasPickedUsername) return;
    if (startIntroIfPending()) {
      router.replace("/(tabs)");
    }
  }, [hasPickedUsername, isInTabs, isLoaded, isNavigationReady, router]);

  if (phase !== "pages") return null;
  return <IntroFlow />;
}
