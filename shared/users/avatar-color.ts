/**
 * Which tint a person's initial circle gets, and what letter goes in it.
 *
 * The rule is deliberately dumb — a sum of the id's char codes, modulo the
 * palette — because it has to be *stable*: the same person keeps the same
 * colour in the friends list, in an invite panel, and beside a showtime, on
 * both clients. Anything that depended on list position or render order would
 * repaint someone a different colour every time the list changed, which is
 * exactly the thing that makes a colour useless as an identity.
 *
 * Only the palette *keys* live here. Turning `"teal"` into an actual colour is
 * each client's business — the app resolves it against its theme object, the
 * website against the Chakra tokens built from the same palette — but both
 * arrive at the same entry of `shared/theme/colors`, so neither can drift.
 */

/** Palette keys that read as distinct faces next to each other. */
export const AVATAR_PALETTE = [
  "blue",
  "purple",
  "teal",
  "orange",
  "pink",
  "cyan",
] as const;

export type AvatarPaletteKey = (typeof AVATAR_PALETTE)[number];

export function getAvatarPaletteKey(userId: string): AvatarPaletteKey {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash + userId.charCodeAt(index)) % AVATAR_PALETTE.length;
  }
  return AVATAR_PALETTE[hash];
}

/** The one letter the circle carries. `?` for a name we never got. */
export function getAvatarInitial(name: string | null | undefined): string {
  return (name ?? "").trim().charAt(0).toUpperCase() || "?";
}
