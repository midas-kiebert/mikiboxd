/**
 * Utility helper for mobile feature logic: Push notifications.
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { MeService } from "shared";

export const ANDROID_PUSH_CHANNEL_ID = "heads-up";

export async function registerPushTokenForCurrentDevice(): Promise<string | null> {
  // Android requires a channel before notifications can be displayed.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_PUSH_CHANNEL_ID, {
      name: "Heads Up",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FFFFFF",
    });
  }

  const permissions = await Notifications.getPermissionsAsync();
  let finalStatus = permissions.status;

  // Ask the user only when permission is not already granted.
  if (finalStatus !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  // Caller can show a friendly prompt when token registration is denied.
  if (finalStatus !== "granted") {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    throw new Error("Missing Expo project ID for push token registration")
  }

  // Register with Expo first, then persist token on our backend.
  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResult.data;

  const platform =
    Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";

  await MeService.registerPushToken({
    requestBody: {
      token,
      platform,
    },
  });

  return token;
}
