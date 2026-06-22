import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import type { VisibilityMode } from "shared";

import type { Colors } from "@/constants/theme";

type ThemeColors = typeof Colors.light;
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

// Order shown in the picker, from most to least visible.
export const VISIBILITY_MODE_ORDER: VisibilityMode[] = [
  "ALL_FRIENDS",
  "FAVORITE_FRIENDS",
  "INVITED_ONLY",
];

export type VisibilityModeMeta = {
  mode: VisibilityMode;
  label: string;
  description: string;
  icon: MaterialIconName;
  color: string;
};

// Your status is always visible to friends you invited (and who invited you),
// regardless of the mode — surfaced in the descriptions below.
export function getVisibilityModeMeta(
  mode: VisibilityMode,
  colors: ThemeColors,
): VisibilityModeMeta {
  switch (mode) {
    case "ALL_FRIENDS":
      return {
        mode,
        label: "All friends",
        description: "Everyone you're friends with can see this.",
        icon: "groups",
        color: colors.green.secondary,
      };
    case "FAVORITE_FRIENDS":
      return {
        mode,
        label: "Favorites",
        description: "Favorite friends — plus anyone you've invited.",
        icon: "star",
        color: colors.yellow.secondary,
      };
    case "INVITED_ONLY":
      return {
        mode,
        label: "Invited only",
        description: "Only friends you've invited, or who invited you.",
        icon: "mail",
        color: colors.blue.secondary,
      };
  }
}
