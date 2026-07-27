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
 * start is gated — once running, the intro stays put wherever the app goes,
 * which is exactly why it forces the showtimes tab the moment it actually
 * starts: a resumed deep link or another tab reached first would otherwise be
 * whatever's revealed once the walkthrough ends.
 */
import { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchCinemas } from "shared/hooks/useFetchCinemas";
import { prefetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";

import IntroFlow from "@/components/intro/IntroFlow";
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
  const queryClient = useQueryClient();
  const isInTabs = (segments as unknown as string[])[0] === TABS_SEGMENT;

  useEffect(() => {
    // The walkthrough opens on a full-screen cinema picker. Fetching that list
    // when the page mounts meant the first thing a brand-new account saw was an
    // empty box that filled in a beat later, so it is pulled the moment we know
    // the intro is coming. A no-op when the root layout's startup warm-up
    // already has it; this covers the replay-from-Settings path and a sign-up
    // that reaches here before the warm-up did.
    if (!isOwed) return;
    void prefetchCinemas(queryClient);
    void prefetchSelectedCinemas(queryClient);
  }, [isOwed, queryClient]);

  useEffect(() => {
    // A no-op unless an account was created on this device and never
    // introduced. Waits for the stored flag, which usually lands after mount.
    if (!isLoaded || !isInTabs) return;
    if (startIntroIfPending()) {
      router.replace("/(tabs)");
    }
  }, [isInTabs, isLoaded, router]);

  if (phase !== "pages") return null;
  return <IntroFlow />;
}
