/**
 * The app's presentation of a Letterboxd watch relationship: the shared copy
 * and icon, resolved against the app's theme colours.
 *
 * The wording, the icon name and which palette draws it come from
 * `shared/friends/friend-watch-kind`, so the website cannot mark "watchlisted"
 * with a different icon or colour than the app does.
 */
import {
  type FriendWatchKind,
  getFriendWatchKindCopy,
} from "shared/friends/friend-watch-kind";

import type { Colors } from "@/constants/theme";

type ThemeColors = typeof Colors.light;

export type { FriendWatchKind };

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
): FriendWatchKindMeta => {
  const { icon, palette, title } = getFriendWatchKindCopy(kind);
  return {
    icon,
    accent: colors[palette].secondary,
    background: colors[palette].primary,
    title,
  };
};
