/**
 * Decides whether the first-run intro is on screen.
 *
 * Mounted once in the root layout, below the splash and above everything else,
 * because the intro covers the whole app — tab bar included — rather than one
 * screen. It only starts the walkthrough; the last step (the filters highlight)
 * belongs to the showtimes screen, which is the only thing that knows when its
 * list is up.
 *
 * It waits for the user to actually be in the tabs before starting: a social
 * sign-in is authenticated while still on the "pick a username" screen, and an
 * intro over that would be covering a form the user has to fill in. Only the
 * start is gated — once running, the intro stays put wherever the app goes.
 */
import { useEffect } from "react";
import { useSegments } from "expo-router";

import IntroFlow from "@/components/intro/IntroFlow";
import { startIntroIfPending, useIntroPhase, useIsIntroLoaded } from "@/utils/intro";

const TABS_SEGMENT = "(tabs)";

export default function IntroHost() {
  const phase = useIntroPhase();
  const isLoaded = useIsIntroLoaded();
  const segments = useSegments();
  const isInTabs = (segments as unknown as string[])[0] === TABS_SEGMENT;

  useEffect(() => {
    // A no-op unless an account was created on this device and never
    // introduced. Waits for the stored flag, which usually lands after mount.
    if (!isLoaded || !isInTabs) return;
    startIntroIfPending();
  }, [isInTabs, isLoaded]);

  if (phase !== "pages") return null;
  return <IntroFlow />;
}
