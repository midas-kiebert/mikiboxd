import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

// Injected by app.config.js, which reads SENTRY_DSN at build time. Absent for
// local builds and anyone without Sentry credentials, so every entry point here
// degrades to a no-op rather than throwing.
const dsn = Constants.expoConfig?.extra?.sentryDsn as string | undefined;

export const isSentryEnabled = Boolean(dsn);

export function initSentry(): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: __DEV__ ? "development" : "production",
    // Crash and error reporting only — no performance tracing, which would
    // sample every navigation for a signal we aren't looking for yet.
    tracesSampleRate: 0,
    // The app has a signed-out browse mode, so the default PII collection
    // would attach device and user identifiers for people who never created
    // an account. Opt out and send only what reportError() passes explicitly.
    sendDefaultPii: false,
  });
}

// axios codes for a request that never reached the server: no connection, a
// dropped one, or a timeout. They describe the user's signal, not the app.
const NETWORK_ERROR_CODES = new Set(["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"]);

function isNetworkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code } = error as { code?: unknown };
  return typeof code === "string" && NETWORK_ERROR_CODES.has(code);
}

/**
 * Report an error the app deliberately swallows.
 *
 * Sentry's automatic handlers only see errors that reach the top of the stack,
 * so anything caught and logged — a failed Play Services call at startup, a
 * push-token refresh that never lands — stays invisible without an explicit
 * hand-off. Keeps the console.error so local debugging is unchanged.
 *
 * Offline failures are demoted to a breadcrumb instead of an issue: anyone who
 * opens the app in a dead spot produces one, so as issues they bury the real
 * failures (a 401, an Expo/FCM rejection) in the same call sites. As
 * breadcrumbs they still ride along on whatever genuine event comes next.
 */
export function reportError(message: string, error: unknown): void {
  console.error(`${message}:`, error);
  if (!dsn) return;

  if (isNetworkError(error)) {
    Sentry.addBreadcrumb({
      category: "network",
      level: "info",
      message,
      data: { error: String(error) },
    });
    return;
  }

  Sentry.captureException(error, { extra: { message } });
}
