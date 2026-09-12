/**
 * Deterministic avatar tints for the initial circles that stand in for a person.
 *
 * Every list that draws a user as a colored initial (Friends tab, invite panel,
 * the watchlisted/watched popups) resolves its colors here, so the same person
 * always keeps the same color wherever they show up.
 *
 * The rule itself is `shared/users/avatar-color`, which the website reads too:
 * a person who is teal in the app has to be teal on the web, and the only way
 * to guarantee that is for one file to decide it. This wrapper does the part
 * that is the app's alone — turning the palette key into a theme color.
 */
import {
  getAvatarInitial as getSharedAvatarInitial,
  getAvatarPaletteKey,
} from "shared/users/avatar-color";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

/** `primary` is the circle fill, `secondary` the initial on top of it. */
export const getAvatarColors = (userId: string, colors: ThemeColors) =>
  colors[getAvatarPaletteKey(userId)];

export const getAvatarInitial = (name: string) => getSharedAvatarInitial(name);
