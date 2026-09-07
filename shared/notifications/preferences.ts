/**
 * The notification-preference model: which preferences exist, what they are
 * called, what order they appear in, and how a row maps onto backend fields.
 *
 * Shared because a row is not always one field. "Seat availability" drives both
 * `notify_on_seat_alert` and `notify_on_sold_out`, and `notify_on_sold_out` has
 * no row of its own — so a client that implemented the list from the field names
 * alone would silently mean something different by the same label. Only the
 * icons are platform-specific, and those stay in
 * `mobile/hooks/useNotificationPreferences.ts`.
 */
import type { NotificationChannel } from "../client";

export type NotificationPreferenceKey =
  | "notify_on_friend_showtime_match"
  | "notify_on_friend_requests"
  | "notify_on_showtime_ping"
  | "notify_on_interest_reminder"
  | "notify_on_seat_alert"
  | "notify_on_sold_out"
  | "notify_on_showtime_reminder";

export type NotificationChannelPreferenceKey =
  | "notify_channel_friend_showtime_match"
  | "notify_channel_friend_requests"
  | "notify_channel_showtime_ping"
  | "notify_channel_interest_reminder"
  | "notify_channel_seat_alert"
  | "notify_channel_sold_out"
  | "notify_channel_showtime_reminder";

/**
 * How one notification type reaches the user. Off and the delivery channel are
 * two backend fields, but they are one decision, so the UI treats them as one
 * three-way choice.
 */
export type NotificationDelivery = "off" | NotificationChannel;

export const DEFAULT_NOTIFICATION_CHANNEL: NotificationChannel = "push";

export const preferenceToChannelKey: Record<
  NotificationPreferenceKey,
  NotificationChannelPreferenceKey
> = {
  notify_on_friend_showtime_match: "notify_channel_friend_showtime_match",
  notify_on_friend_requests: "notify_channel_friend_requests",
  notify_on_showtime_ping: "notify_channel_showtime_ping",
  notify_on_interest_reminder: "notify_channel_interest_reminder",
  notify_on_seat_alert: "notify_channel_seat_alert",
  notify_on_sold_out: "notify_channel_sold_out",
  notify_on_showtime_reminder: "notify_channel_showtime_reminder",
};

/**
 * "Almost sold out" and "Sold out" are two backend fields (and two push kinds)
 * but one decision for the user, so `notify_on_seat_alert`'s row also drives
 * `notify_on_sold_out` and neither is shown separately in `TOGGLE_ORDER`.
 */
export const LINKED_PREFERENCE_KEYS: Partial<
  Record<NotificationPreferenceKey, NotificationPreferenceKey[]>
> = {
  notify_on_seat_alert: ["notify_on_sold_out"],
};

/**
 * Labels carry the whole explanation, so they have to stand on their own.
 */
export const NOTIFICATION_LABELS: Record<NotificationPreferenceKey, string> = {
  notify_on_friend_showtime_match: "Friend activity",
  notify_on_showtime_ping: "Invites",
  notify_on_interest_reminder: "Interest reminders",
  notify_on_seat_alert: "Seat availability",
  notify_on_sold_out: "Sold out",
  notify_on_friend_requests: "Friend requests",
  notify_on_showtime_reminder: "Reminders from friends",
};

/**
 * Fixed display order, which is not the declaration order above.
 * `notify_on_sold_out` is deliberately absent: it rides along with
 * `notify_on_seat_alert` via `LINKED_PREFERENCE_KEYS` instead of its own row.
 */
export const TOGGLE_ORDER: readonly NotificationPreferenceKey[] = [
  "notify_on_friend_showtime_match",
  "notify_on_showtime_ping",
  "notify_on_showtime_reminder",
  "notify_on_interest_reminder",
  "notify_on_seat_alert",
  "notify_on_friend_requests",
];

export const normalizeChannel = (
  channel: NotificationChannel | null | undefined
): NotificationChannel =>
  channel === "email" ? "email" : DEFAULT_NOTIFICATION_CHANNEL;

type PreferenceSource =
  | (Partial<Record<NotificationPreferenceKey, boolean>> &
      Partial<Record<NotificationChannelPreferenceKey, NotificationChannel | null>>)
  | null
  | undefined;

/** The three-way value a row should show, read off the current user. */
export const getDelivery = (
  source: PreferenceSource,
  key: NotificationPreferenceKey
): NotificationDelivery => {
  if (!source?.[key]) return "off";
  return normalizeChannel(source[preferenceToChannelKey[key]]);
};

/**
 * The patch that sets one row to a delivery, including every field the row
 * drives. Both clients write through this so a linked preference cannot be left
 * behind by one of them.
 */
export const buildDeliveryUpdate = (
  key: NotificationPreferenceKey,
  delivery: NotificationDelivery
): Record<string, boolean | NotificationChannel> => {
  const keys = [key, ...(LINKED_PREFERENCE_KEYS[key] ?? [])];
  const enabled = delivery !== "off";
  const patch: Record<string, boolean | NotificationChannel> = {};

  for (const entry of keys) {
    patch[entry] = enabled;
    if (enabled) patch[preferenceToChannelKey[entry]] = delivery;
  }

  return patch;
};
