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

/**
 * Report an error the app deliberately swallows.
 *
 * Sentry's automatic handlers only see errors that reach the top of the stack,
 * so anything caught and logged — a failed Play Services call at startup, a
 * push-token refresh that never lands — stays invisible without an explicit
 * hand-off. Keeps the console.error so local debugging is unchanged.
 */
export function reportError(message: string, error: unknown): void {
  console.error(`${message}:`, error);
  if (!dsn) return;
  Sentry.captureException(error, { extra: { message } });
}
