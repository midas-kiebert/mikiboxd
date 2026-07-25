/**
 * The two Letterboxd relationships a friend can have with a film, and the icon /
 * color / wording each one gets. Centralised so the showtime sheet, the movie
 * page and the shared popup all mark "watchlisted" and "watched" identically.
 */

type ThemeColors = typeof import("@/constants/theme").Colors.light;

export type FriendWatchKind = "watchlisted" | "watched";

type FriendWatchKindMeta = {
  icon: "schedule" | "visibility";
  /** Icon/text color; `background` is the matching soft fill behind it. */
  accent: string;
  background: string;
  /** Popup heading — deliberately just the relationship, nothing else. */
  title: string;
};

export const getFriendWatchKindMeta = (
  kind: FriendWatchKind,
  colors: ThemeColors
): FriendWatchKindMeta =>
  kind === "watchlisted"
    ? {
        icon: "schedule",
        accent: colors.orange.secondary,
        background: colors.orange.primary,
        title: "Watchlisted",
      }
    : {
        icon: "visibility",
        accent: colors.green.secondary,
        background: colors.green.primary,
        title: "Watched",
      };
