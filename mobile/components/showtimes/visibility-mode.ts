import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import type { VisibilityMode } from "shared";

import type { Colors } from "@/constants/theme";

type ThemeColors = typeof Colors.light;
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

// Order shown in the dropdown, from most to least visible.
export const VISIBILITY_MODE_ORDER: VisibilityMode[] = [
  "ALL_FRIENDS",
  "INVITED_ONLY",
];

export type VisibilityModeMeta = {
  mode: VisibilityMode;
  label: string;
  description: string;
  icon: MaterialIconName;
  color: string;
};

// "All friends" only includes friends you haven't opted out of. Your status is
// always visible to friends you invited, friends who invited you, and friends
// co-invited by the same person — regardless of the mode.
export function getVisibilityModeMeta(
  mode: VisibilityMode,
  colors: ThemeColors,
): VisibilityModeMeta {
  switch (mode) {
    case "ALL_FRIENDS":
      return {
        mode,
        label: "All friends",
        description: "Every friend you haven't hidden your status from.",
        icon: "groups",
        color: colors.green.secondary,
      };
    case "INVITED_ONLY":
      return {
        mode,
        label: "Invited only",
        description: "Only friends in this invite — nobody else.",
        icon: "mail",
        color: colors.blue.secondary,
      };
  }
}
