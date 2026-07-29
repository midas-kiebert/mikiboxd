/**
 * Landing route for `mikino.nl/ping/{showtimeId}/{sender}` invite links.
 *
 * The invite itself is handled by the root layout, which reads the URL directly
 * whether it arrived at launch or while the app was running. This screen exists
 * only because expo-router has to route the URL somewhere: it renders nothing
 * and gets out of the way again.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { useIsAppReady } from "@/utils/app-ready";

export default function PingLinkScreen() {
  const router = useRouter();
  const isAppReady = useIsAppReady();
  const handledRef = useRef(false);

  useEffect(() => {
    // Navigating during the shell's first commits throws; on a cold start this
    // screen simply sits behind the splash until it is safe.
    if (!isAppReady || handledRef.current) return;
    handledRef.current = true;

    // Popping, not replacing: this screen's options make its own transitions
    // instant, so a pop is invisible, whereas replacing it with the tabs would
    // slide a fresh tabs card in over a screen the user is already looking at.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [isAppReady, router]);

  return null;
}
