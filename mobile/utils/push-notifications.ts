/**
 * Utility helper for mobile feature logic: Push notifications.
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import { Platform } from "react-native";
import { MeService, ShowtimesService } from "shared";

type PushTokenRegistrationState = {
  token: string;
  platform: string;
  registeredAt: number;
};

type PushTokenRegistrationOptions = {
  force?: boolean;
  userId?: string;
};

// Channel ID is versioned to recover from user-disabled/stale channel configs.
export const ANDROID_PUSH_CHANNEL_ID = "mikino-heads-up-v2";
const LEGACY_ANDROID_PUSH_CHANNEL_ID = "heads-up";
export const SHOWTIME_PING_NOTIFICATION_CATEGORY_ID = "showtime-ping";
export const SHOWTIME_PING_ACTION_INTERESTED_ID = "showtime-ping-interest";

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
      const showtimeId = parsePositiveInteger(data.showtimeId);
      if (movieId === null) {
        return "/(tabs)";
      }
      const params: { id: string; showtimeId?: string } = {
        id: String(movieId),
      };
      if (showtimeId !== null) {
        params.showtimeId = String(showtimeId);
      }
      return {
        pathname: "/movie/[id]",
        params,
      };
    }
    case "friend_request_received":
      return {
        pathname: "/(tabs)/friends",
        params: { tab: "received" },
      };
    case "friend_request_accepted":
      return { pathname: "/(tabs)/friends", params: { tab: "friends" } };
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

async function getProjectId(): Promise<string | null> {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

const PUSH_TOKEN_RETRY_SCOPE_ANONYMOUS = "__anonymous__";
const MAX_TOKEN_REGISTRATION_AGE_MS = 12 * 60 * 60 * 1000;
const PUSH_TOKEN_REGISTRATION_THROTTLE_MS = 1000;

const lastTokenRegistrationByScope = new Map<string, PushTokenRegistrationState>();
const registerPushTokenInFlightByScope = new Map<string, Promise<string | null>>();
const lastTokenRegistrationAttemptByScope = new Map<string, number>();

const getPushTokenRegistrationScope = (userId?: string): string =>
  userId && userId.length > 0 ? `user:${userId}` : PUSH_TOKEN_RETRY_SCOPE_ANONYMOUS;

const getNow = (): number => Date.now();

const isPushTokenRegistrationFresh = (
  scope: string,
  token: string,
  platform: string
): boolean => {
  const lastState = lastTokenRegistrationByScope.get(scope);
  if (!lastState) {
    return false;
  }
  const isSameToken = lastState.token === token;
  const isSamePlatform = lastState.platform === platform;
  const isFresh = getNow() - lastState.registeredAt < MAX_TOKEN_REGISTRATION_AGE_MS;
  return isSameToken && isSamePlatform && isFresh;
};

const setTokenRegistrationState = (scope: string, token: string, platform: string): void => {
  lastTokenRegistrationByScope.set(scope, {
    token,
    platform,
    registeredAt: getNow(),
  });
};

const clearPushTokenRegistrationStateForToken = (token: string): void => {
  for (const [scope, state] of lastTokenRegistrationByScope.entries()) {
    if (state.token === token) {
      lastTokenRegistrationByScope.delete(scope);
      lastTokenRegistrationAttemptByScope.delete(scope);
    }
  }
};

const isLikelyExpoPushToken = (token: string): boolean =>
  token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const ensureAndroidNotificationChannels = async (force: boolean): Promise<void> => {
  const channelConfig = {
    name: "Heads Up",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FFFFFF",
  };

  const channelIds = [ANDROID_PUSH_CHANNEL_ID, LEGACY_ANDROID_PUSH_CHANNEL_ID];
  for (const channelId of channelIds) {
    if (force) {
      try {
        const existing = await Notifications.getNotificationChannelAsync(channelId);
        if (existing) {
          await Notifications.deleteNotificationChannelAsync(channelId);
        }
      } catch {
        // Best effort cleanup before recreation.
      }
    }
    await Notifications.setNotificationChannelAsync(channelId, channelConfig);
  }
};

export async function registerPushTokenForCurrentDevice(
  options: PushTokenRegistrationOptions = {}
): Promise<string | null> {
  const { force = false, userId } = options;
  const scope = getPushTokenRegistrationScope(userId);
  const now = getNow();

  if (!force) {
    const lastAttempt = lastTokenRegistrationAttemptByScope.get(scope);
    const lastState = lastTokenRegistrationByScope.get(scope);
    if (
      lastAttempt !== undefined &&
      now - lastAttempt < PUSH_TOKEN_REGISTRATION_THROTTLE_MS
    ) {
      return lastState ? lastState.token : null;
    }
    lastTokenRegistrationAttemptByScope.set(scope, now);
  }

  const inFlight = registerPushTokenInFlightByScope.get(scope);
  if (inFlight) {
    return inFlight;
  }

  const registrationPromise = (async (): Promise<string | null> => {
    // Android requires a channel before notifications can be displayed.
    if (Platform.OS === "android") {
      await ensureAndroidNotificationChannels(force);
    }

    const permissions = await Notifications.getPermissionsAsync();
    let finalStatus = permissions.status;

    // Ask the user only when permission is not already granted.
    if (finalStatus !== "granted") {
      const requested =
        Platform.OS === "ios"
          ? await Notifications.requestPermissionsAsync({
              ios: {
                allowAlert: true,
                allowBadge: true,
                allowSound: true,
              },
            })
          : await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    // Caller can show a friendly prompt when token registration is denied.
    if (finalStatus !== "granted") {
      return null;
    }

    const projectId = await getProjectId();
    if (!projectId) {
      throw new Error("Missing Expo project ID for push token registration");
    }
    const applicationId = Constants.expoConfig?.android?.package ?? undefined;

    let tokenResult: Notifications.ExpoPushToken;

    if (Platform.OS === "android") {
      // Fail loudly on Android registration issues so we can debug FCM mapping problems.
      let devicePushToken: Notifications.DevicePushToken;
      try {
        devicePushToken = await Notifications.getDevicePushTokenAsync();
      } catch (error) {
        throw new Error(
          `Failed to fetch native Android push token (projectId=${projectId}, applicationId=${
            applicationId ?? "unknown"
          }): ${getErrorMessage(error)}`
        );
      }

      if (devicePushToken.type !== "android" && devicePushToken.type !== "fcm") {
        throw new Error(
          `Unexpected Android native token type "${devicePushToken.type}" (expected "android")`
        );
      }

      if (typeof devicePushToken.data !== "string" || devicePushToken.data.length === 0) {
        throw new Error("Android native FCM token is empty");
      }

      try {
        tokenResult = await Notifications.getExpoPushTokenAsync({
          projectId,
          applicationId,
          devicePushToken,
        });
      } catch (error) {
        throw new Error(
          `Failed to map native FCM token to Expo push token (projectId=${projectId}, applicationId=${
            applicationId ?? "unknown"
          }): ${getErrorMessage(error)}`
        );
      }
    } else {
      tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    }

    const token = tokenResult.data;
    const platform =
      Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";

    if (!isLikelyExpoPushToken(token)) {
      throw new Error("Received a non-Expo push token during registration");
    }

    if (
      !force &&
      finalStatus === "granted" &&
      isPushTokenRegistrationFresh(scope, token, platform)
    ) {
      return token;
    }

    await MeService.registerPushToken({
      requestBody: {
        token,
        platform,
      },
    });
    setTokenRegistrationState(scope, token, platform);

    return token;
  })();

  registerPushTokenInFlightByScope.set(scope, registrationPromise);

  try {
    return await registrationPromise;
  } finally {
    if (registerPushTokenInFlightByScope.get(scope) === registrationPromise) {
      registerPushTokenInFlightByScope.delete(scope);
    }
  }
}

export const clearPushTokenRegistrationState = (scope?: string): void => {
  if (scope) {
    lastTokenRegistrationByScope.delete(scope);
    registerPushTokenInFlightByScope.delete(scope);
    lastTokenRegistrationAttemptByScope.delete(scope);
    return;
  }
  lastTokenRegistrationByScope.clear();
  registerPushTokenInFlightByScope.clear();
  lastTokenRegistrationAttemptByScope.clear();
};

export const clearPushTokenRegistrationStateForCurrentUser = (userId?: string): void => {
  const scope = getPushTokenRegistrationScope(userId);
  lastTokenRegistrationByScope.delete(scope);
  registerPushTokenInFlightByScope.delete(scope);
  lastTokenRegistrationAttemptByScope.delete(scope);
};

export async function unregisterPushTokenForCurrentDevice(): Promise<void> {
  try {
    const projectId = await getProjectId();
    if (!projectId) {
      return;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });

    await MeService.deletePushToken({
      requestBody: {
        token: tokenResult.data,
      },
    });
    clearPushTokenRegistrationStateForToken(tokenResult.data);
  } catch {
    // Ignore token unregistration errors during logout.
  }
}
