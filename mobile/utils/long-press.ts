import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

export const GLOBAL_LONG_PRESS_DELAY_MS = 320;

export function triggerLongPressHaptic() {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press);
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

/**
 * Subtle feedback for discrete selections (toggling a status, picking a preset,
 * opening a filter sheet). Use for the common "I tapped a control" cases.
 */
export function triggerSelectionHaptic() {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click);
    return;
  }
  void Haptics.selectionAsync();
}

/**
 * A tab-bar press.
 *
 * Kept apart from {@link triggerSelectionHaptic} only because iOS has always
 * answered a tab with an impact rather than a selection tick, and that is the
 * feel the app shipped with; Android gets the same light tick every other
 * control here gets. Both platforms buzz — the Expo tab template this started
 * from fired on iOS only, on the grounds that Android "already has native
 * ripple feedback", but a ripple is something you see, not something you feel.
 */
export function triggerTabPressHaptic() {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click);
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/**
 * A slightly more pronounced tap than {@link triggerSelectionHaptic} for
 * meaningful one-shot actions (e.g. sending a friend invite).
 */
export function triggerImpactHaptic() {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm);
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
