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
