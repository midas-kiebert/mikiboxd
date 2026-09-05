/**
 * `expo-notifications`, imported in a way that cannot take the app down.
 *
 * **Importing `expo-notifications` throws in Expo Go on Android**, with the
 * package's own "Android Push notifications (remote notifications) ... was
 * removed from Expo Go with the release of SDK 53" error. Something reached
 * during the package's module evaluation calls its internal
 * `warnOfExpoGoPushUsage()`, which on Android throws rather than warning. The
 * exact statement was never pinned down — every call site of that guard reads
 * as being inside a function — so treat the mechanism as observed rather than
 * fully explained, and do not "simplify" this module on the assumption that a
 * plain import is safe.
 *
 * It is new since SDK 54: Expo Go ran this app fine then, and the package's
 * index gained `./topicSubscription` (Android-only, remote-push-only) in
 * SDK 55, which is the most likely thing to have introduced it.
 *
 * The failure is silent and very misleading. expo-router loads routes with
 * `ignoreRequireErrors`, so the throw is swallowed by a bare `catch {}` and
 * every route that (transitively) imports notifications is reported only as
 * `Route "./x.tsx" is missing the required default export` — for routes that
 * plainly have one. Nothing renders, so `SplashScreen.hideAsync()` never runs
 * and the app sits on the native splash forever. The separate
 * "removed from Expo Go" errors in the log are unrelated noise.
 *
 * So the module is required lazily, behind a try/catch, and a set of inert
 * fallbacks stands in when it cannot be loaded: the app boots in Expo Go with
 * notifications simply absent, which is the truth of that environment. Every
 * real build — dev client, preview, store — gets the genuine module and is
 * completely unaffected.
 *
 * Call sites keep reading `Notifications.foo(...)`; only the import changes.
 * Companion to {@link ./google-signin}, which does the same for a native module
 * Expo Go also lacks.
 */
import { isRunningInExpoGo } from "expo";
import { Platform } from "react-native";
import type * as NotificationsModule from "expo-notifications";

type Notifications = typeof NotificationsModule;

/** The one environment where failing to load this is normal, not a fault. */
const isExpectedToBeMissing = isRunningInExpoGo() && Platform.OS === "android";

/** A subscription that is already, permanently, doing nothing. */
const inertSubscription = { remove: () => {} };

/**
 * Enough of the surface for the app to run with notifications absent. Values
 * mirror the real ones so comparisons against them still behave
 * (`AndroidImportance.MAX`, the default action identifier); everything that
 * would reach the OS resolves to "nothing here" rather than throwing, because
 * a caller in Expo Go has no better branch to take.
 */
const unavailable = {
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  AndroidImportance: {
    UNKNOWN: 0,
    UNSPECIFIED: 1,
    NONE: 2,
    MIN: 3,
    LOW: 4,
    DEFAULT: 5,
    HIGH: 6,
    MAX: 7,
  },
  // Permission reads answer "not granted, do not ask": Expo Go on Android
  // cannot deliver a notification, so a prompt would buy the user nothing.
  getPermissionsAsync: async () => ({
    status: "denied",
    canAskAgain: false,
    granted: false,
    expires: "never",
  }),
  requestPermissionsAsync: async () => ({
    status: "denied",
    canAskAgain: false,
    granted: false,
    expires: "never",
  }),
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => null,
  getNotificationChannelAsync: async () => null,
  deleteNotificationChannelAsync: async () => {},
  setNotificationCategoryAsync: async () => null,
  getLastNotificationResponseAsync: async () => null,
  clearLastNotificationResponseAsync: async () => {},
  addNotificationResponseReceivedListener: () => inertSubscription,
  addPushTokenListener: () => inertSubscription,
};

let cached: Notifications | null = null;
let loadFailed = false;

function load(): Notifications | null {
  if (cached || loadFailed) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-notifications") as Notifications;
  } catch (error) {
    loadFailed = true;
    // Silent where it is expected. In Expo Go on Android this failure is the
    // documented state of the world, not news, and it fires on every launch —
    // a warning there is noise that trains you to ignore the console. Anywhere
    // else it means notifications are silently off in a build that should have
    // them, which is worth shouting about.
    if (!isExpectedToBeMissing) {
      console.warn(
        "[notifications] expo-notifications could not be loaded — running without notifications.",
        error
      );
    }
  }
  return cached;
}

/**
 * Whether the real module is behind {@link Notifications}. False means every
 * call below is an inert stand-in, so a caller that needs to *tell the user*
 * notifications are off should branch on this rather than on a return value.
 */
export function isNotificationsModuleAvailable(): boolean {
  return load() !== null;
}

/**
 * The module, or the inert stand-ins. Resolved on first property access rather
 * than at import, which is the whole point — see the note at the top.
 */
export const Notifications = new Proxy({} as Notifications, {
  get(_target, property: string) {
    const real = load();
    if (real) return real[property as keyof Notifications];
    return unavailable[property as keyof typeof unavailable];
  },
}) as Notifications;
