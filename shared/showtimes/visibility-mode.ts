/**
 * Who can see that you picked a showtime.
 *
 * The wording here is a privacy promise, so it lives in one place and both
 * clients read it: an app and a website describing the same setting differently
 * is how people end up sharing more than they meant to. The icon and the palette
 * are here for the same reason — a setting marked with a different glyph on each
 * client is the same problem one step quieter. Only resolving them against a
 * theme is the client's own; `mobile/components/showtimes/visibility-mode.ts`
 * wraps this for the app.
 *
 * "Friends" means every friend you have not hidden your status from. Whichever
 * mode is set, your status is always visible to friends you invited, friends
 * who invited you, and friends co-invited by the same person.
 */
import type { VisibilityMode } from "../client";

/** Order shown in the picker, from most visible to least. */
export const VISIBILITY_MODE_ORDER: VisibilityMode[] = [
  "FRIENDS_OF_FRIENDS",
  "ALL_FRIENDS",
  "INVITED_ONLY",
];

export type VisibilityModePresentation = {
  /** A MaterialIcons name; both clients resolve it to their own icon set. */
  icon: "hub" | "groups" | "mail";
  /** Which palette trio draws it. */
  palette: "purple" | "green" | "blue";
};

const PRESENTATION: Record<VisibilityMode, VisibilityModePresentation> = {
  FRIENDS_OF_FRIENDS: { icon: "hub", palette: "purple" },
  ALL_FRIENDS: { icon: "groups", palette: "green" },
  INVITED_ONLY: { icon: "mail", palette: "blue" },
};

export function getVisibilityModePresentation(
  mode: VisibilityMode
): VisibilityModePresentation {
  return PRESENTATION[mode];
}

export type VisibilityModeCopy = {
  mode: VisibilityMode;
  label: string;
  description: string;
};

export function getVisibilityModeCopy(mode: VisibilityMode): VisibilityModeCopy {
  switch (mode) {
    case "FRIENDS_OF_FRIENDS":
      return {
        mode,
        label: "Friends of friends",
        description:
          "All your friends, and their friends when they're going or interested.",
      };
    case "ALL_FRIENDS":
      return {
        mode,
        label: "Friends",
        description: "Every friend you haven't hidden your status from.",
      };
    case "INVITED_ONLY":
      return {
        mode,
        label: "Invited only",
        description: "Only friends in this invite.",
      };
  }
}
