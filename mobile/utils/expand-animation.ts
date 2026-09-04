/**
 * Shared expand/collapse animation for disclosure toggles (a caret that spins
 * 180° while the panel below tweens open).
 *
 * There used to be a `UIManager.setLayoutAnimationEnabledExperimental(true)`
 * here, because LayoutAnimation needed an explicit opt-in on Android. Under the
 * New Architecture — the only architecture from SDK 55 on — that call is a
 * no-op and says so, loudly, on every launch. LayoutAnimation is enabled on
 * both platforms without it, so it is gone.
 *
 * Note that LayoutAnimation itself is deprecated under the New Architecture and
 * the replacement is Reanimated's layout animations. That migration is not done
 * here; this module still works, but it is living on borrowed time.
 */
import { LayoutAnimation } from "react-native";

/** Duration of both the caret spin and the panel height tween. */
export const EXPAND_DURATION_MS = 220;

/** Smooth height tween for an expand/collapse "swipe open". */
export const EXPAND_LAYOUT_ANIMATION = {
  duration: EXPAND_DURATION_MS,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};
