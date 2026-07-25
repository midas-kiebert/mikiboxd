/**
 * Deterministic avatar tints for the initial circles that stand in for a person.
 *
 * Every list that draws a user as a colored initial (Friends tab, invite panel,
 * the watchlisted/watched popups) resolves its colors here, so the same person
 * always keeps the same color wherever they show up.
 */

type ThemeColors = typeof import("@/constants/theme").Colors.light;

/** Palette keys that read as distinct faces next to each other. */
const AVATAR_PALETTE = ["blue", "purple", "teal", "orange", "pink", "cyan"] as const;

const getAvatarPaletteKey = (userId: string) => {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash + userId.charCodeAt(index)) % AVATAR_PALETTE.length;
  }
  return AVATAR_PALETTE[hash];
};

/** `primary` is the circle fill, `secondary` the initial on top of it. */
export const getAvatarColors = (userId: string, colors: ThemeColors) =>
  colors[getAvatarPaletteKey(userId)];

export const getAvatarInitial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
