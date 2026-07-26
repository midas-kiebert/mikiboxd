/**
 * Shared expand/collapse animation for disclosure toggles (a caret that spins
 * 180° while the panel below tweens open).
 *
 * Importing this module also flips on Android's LayoutAnimation opt-in, so any
 * screen using `EXPAND_LAYOUT_ANIMATION` gets the height tween on both
 * platforms without repeating the UIManager dance.
 */
import { LayoutAnimation, Platform, UIManager } from "react-native";

// LayoutAnimation needs an explicit opt-in on Android (on by default on iOS).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Duration of both the caret spin and the panel height tween. */
export const EXPAND_DURATION_MS = 220;

/** Smooth height tween for an expand/collapse "swipe open". */
export const EXPAND_LAYOUT_ANIMATION = {
  duration: EXPAND_DURATION_MS,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};
