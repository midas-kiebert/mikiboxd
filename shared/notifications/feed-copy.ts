/**
 * How one notification feed item is worded.
 *
 * Split out of the app's `NotificationRow` so the website says exactly the same
 * thing about the same event. Only the icon and accent colour are
 * platform-specific, and the two clients pick those themselves from `type`.
 *
 * Pure apart from luxon, which both platforms already depend on.
 */
import { DateTime } from "luxon";
import type { NotificationFeedItem } from "../client";

export type NotificationCopy = {
  title: string;
  subtitle: string | null;
};

const actorName = (item: NotificationFeedItem): string =>
  item.actor?.display_name?.trim() || "A friend";

/**
 * The feed item does not carry the going/interested status directly, so it is
 * derived from the showtime's friend lists — the actor appears in one of them.
 */
const actorStatus = (
  item: NotificationFeedItem
): "going" | "interested" | null => {
  const actorId = item.actor?.id;
  const showtime = item.showtime;
  if (!actorId || !showtime) return null;
  if (showtime.viewer?.friends_going?.some((u) => u.id === actorId)) return "going";
  if (showtime.viewer?.friends_interested?.some((u) => u.id === actorId))
    return "interested";
  return null;
};

export const formatShowtimeSubtitle = (
  item: NotificationFeedItem,
  prefix?: string
): string | null => {
  const showtime = item.showtime;
  if (!showtime) return prefix ?? null;
  const dt = DateTime.fromISO(showtime.datetime);
  const dateTime = dt.isValid
    ? `${dt.toFormat("ccc, LLL d")} · ${dt.toFormat("HH:mm")}`
    : null;
  const parts = [prefix, dateTime, showtime.cinema.name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
};

export const getNotificationCopy = (
  item: NotificationFeedItem
): NotificationCopy => {
  const name = actorName(item);
  const movie = item.showtime?.movie.title ?? null;
  const status = actorStatus(item);
  const statusVerb = status === "going" ? "is going to" : "is interested in";
  const bareStatus =
    statusVerb === "is going to" ? "is going" : "is interested";

  switch (item.type) {
    case "friend_showtime_match":
      return {
        title: movie ? `${name} ${statusVerb} ${movie}` : `${name} ${bareStatus}`,
        subtitle: formatShowtimeSubtitle(item),
      };
    case "invite_response":
      return {
        title: movie ? `${name} ${statusVerb} ${movie}` : `${name} ${bareStatus}`,
        subtitle: formatShowtimeSubtitle(item, "Replied to your invite"),
      };
    case "showtime_invite":
      return {
        title: movie ? `${name} invited you to ${movie}` : `${name} invited you`,
        subtitle: formatShowtimeSubtitle(item),
      };
    case "friend_request_received":
      return { title: `${name} sent you a friend request`, subtitle: null };
    case "friend_request_accepted":
      return { title: `${name} accepted your friend request`, subtitle: null };
    // The three items nobody caused: the cinema's own seat count moved.
    case "seats_running_out":
      return {
        title: movie ? `${movie} is nearly sold out` : "Nearly sold out",
        subtitle: formatShowtimeSubtitle(item),
      };
    case "sold_out":
      return {
        title: movie ? `${movie} is sold out` : "Sold out",
        subtitle: formatShowtimeSubtitle(item),
      };
    case "seats_released":
      return {
        title: movie ? `Tickets available for ${movie}` : "Tickets available",
        subtitle: formatShowtimeSubtitle(item),
      };
  }
};
