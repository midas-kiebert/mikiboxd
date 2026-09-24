/**
 * The app's presentation of a visibility mode: the shared copy, icon and
 * palette, resolved against the app's theme.
 *
 * The label, description, icon name and palette all come from
 * `shared/showtimes/visibility-mode`, so the website cannot drift from the app
 * on what a privacy setting promises or on how it is marked. What is left here
 * is the part that is the app's alone: turning the palette name into a colour.
 */
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import type { VisibilityMode } from "shared";
import {
  getVisibilityModeCopy,
  getVisibilityModePresentation,
} from "shared/showtimes/visibility-mode";

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

export function getVisibilityModeMeta(
  mode: VisibilityMode,
  colors: ThemeColors,
): VisibilityModeMeta {
  const { icon, palette } = getVisibilityModePresentation(mode);
  return {
    ...getVisibilityModeCopy(mode),
    icon,
    color: colors[palette].secondary,
  };
}
