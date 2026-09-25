/**
 * Which palette entry a cinema's accent colour is.
 *
 * `badge_bg_color` is a palette *key* ("purple", "teal"), not a colour: the
 * two clients hold the same palette and each resolves the key against its own
 * theme. Resolving it in one place is what keeps a cinema the same colour in
 * the app's pill, in the website's badge, and in the header of its own page —
 * which is the whole reason the colour exists.
 *
 * A cinema whose key is missing or unrecognised falls back to a hash of its
 * name rather than to one shared default, so unconfigured venues still read as
 * different from each other instead of collapsing into a single grey.
 */
import type { CinemaPublic } from "../client";

/** The general-purpose accents: what an unconfigured cinema's name hashes into. */
const GENERAL_PALETTE_KEYS = [
  "pink",
  "purple",
  "green",
  "orange",
  "yellow",
  "blue",
  "teal",
  "red",
  "cyan",
] as const;

/**
 * Plus the brand colours a festival is given by name in cinemas.yaml. Kept
 * out of the hash, so no unconfigured venue ever lands on a brand's colour
 * and adding one doesn't reshuffle every hashed venue's colour.
 */
export const CINEMA_PALETTE_KEYS = [...GENERAL_PALETTE_KEYS, "liff"] as const;

export type CinemaPaletteKey = (typeof CINEMA_PALETTE_KEYS)[number];

const isCinemaPaletteKey = (value: string): value is CinemaPaletteKey =>
  (CINEMA_PALETTE_KEYS as readonly string[]).includes(value);

export function getCinemaPaletteKey(
  cinema: Pick<CinemaPublic, "name" | "badge_bg_color">
): CinemaPaletteKey {
  if (cinema.badge_bg_color && isCinemaPaletteKey(cinema.badge_bg_color)) {
    return cinema.badge_bg_color;
  }
  const hash = cinema.name
    .split("")
    .reduce((accumulator, char) => accumulator * 31 + char.charCodeAt(0), 0);
  return GENERAL_PALETTE_KEYS[Math.abs(hash) % GENERAL_PALETTE_KEYS.length];
}
