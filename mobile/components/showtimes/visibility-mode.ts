/**
 * The app's presentation of a visibility mode: the shared copy, plus the icon
 * and theme colour that only make sense here.
 *
 * The label and description come from `shared/showtimes/visibility-mode`, so
 * the website cannot drift from the app on what a privacy setting promises.
 */
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import type { VisibilityMode } from "shared";
import { getVisibilityModeCopy } from "shared/showtimes/visibility-mode";

import type { Colors } from "@/constants/theme";

export { VISIBILITY_MODE_ORDER } from "shared/showtimes/visibility-mode";

type ThemeColors = typeof Colors.light;
type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

export type VisibilityModeMeta = {
  mode: VisibilityMode;
  label: string;
  description: string;
  icon: MaterialIconName;
  color: string;
};

const PRESENTATION: Record<
  VisibilityMode,
  { icon: MaterialIconName; color: (colors: ThemeColors) => string }
> = {
  FRIENDS_OF_FRIENDS: { icon: "hub", color: (colors) => colors.purple.secondary },
  ALL_FRIENDS: { icon: "groups", color: (colors) => colors.green.secondary },
  INVITED_ONLY: { icon: "mail", color: (colors) => colors.blue.secondary },
};

export function getVisibilityModeMeta(
  mode: VisibilityMode,
  colors: ThemeColors,
): VisibilityModeMeta {
  const { icon, color } = PRESENTATION[mode];
  return { ...getVisibilityModeCopy(mode), icon, color: color(colors) };
}
