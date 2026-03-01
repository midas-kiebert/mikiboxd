/**
 * Utility helper for mobile feature logic: Push notifications.
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import { Platform } from "react-native";
import { MeService, ShowtimesService } from "shared";

export const ANDROID_PUSH_CHANNEL_ID = "heads-up";
export const SHOWTIME_PING_NOTIFICATION_CATEGORY_ID = "showtime-ping";
export const SHOWTIME_PING_ACTION_INTERESTED_ID = "showtime-ping-interest";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PushNotificationData = {
  type?: unknown;
  showtimeId?: unknown;
  movieId?: unknown;
  senderId?: unknown;
  accepterId?: unknown;
};

const isPushNotificationData = (
  value: unknown
): value is PushNotificationData & Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseUuid = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
};

export async function configureNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(
    SHOWTIME_PING_NOTIFICATION_CATEGORY_ID,
    [
      {
        identifier: SHOWTIME_PING_ACTION_INTERESTED_ID,
        buttonTitle: "I'm Interested",
        options: {
          opensAppToForeground: true,
        },
      },
    ]
  );
}

export const canRouteFromNotificationAction = (
  actionIdentifier: string
): boolean =>
  actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ||
  actionIdentifier === SHOWTIME_PING_ACTION_INTERESTED_ID;

export function resolveNotificationRoute(data: unknown): Href | null {
  if (!isPushNotificationData(data) || typeof data.type !== "string") {
    return null;
  }

  switch (data.type) {
    case "showtime_ping":
      return "/(tabs)/pings";
    case "showtime_match":
    case "showtime_status_removed":
    case "showtime_interest_reminder": {
      const movieId = parsePositiveInteger(data.movieId);
      return movieId === null
        ? "/(tabs)"
        : { pathname: "/movie/[id]", params: { id: String(movieId) } };
    }
    case "friend_request_received":
      return "/(tabs)/friends";
    case "friend_request_accepted": {
      const accepterId = parseUuid(data.accepterId);
      return accepterId === null
        ? "/(tabs)/friends"
        : { pathname: "/friend-showtimes/[id]", params: { id: accepterId } };
    }
    default:
      return null;
  }
}

export async function handleNotificationQuickAction(
  response: Notifications.NotificationResponse
): Promise<boolean> {
  if (response.actionIdentifier !== SHOWTIME_PING_ACTION_INTERESTED_ID) {
    return false;
  }

  const data = response.notification.request.content.data;
  if (!isPushNotificationData(data) || data.type !== "showtime_ping") {
    return false;
  }

  const showtimeId = parsePositiveInteger(data.showtimeId);
  if (showtimeId === null) {
    return false;
  }

  await ShowtimesService.updateShowtimeSelection({
    showtimeId,
    requestBody: {
      going_status: "INTERESTED",
    },
  });
  return true;
}

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
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
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
