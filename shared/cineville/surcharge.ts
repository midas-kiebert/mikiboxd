/**
 * The warning for a Cineville screening that costs extra on top of the pass,
 * e.g. "+€5,00" for a live-music screening at Eye. Null when there is nothing
 * to warn about: no surcharge read, or none charged.
 */
export function cinevilleSurchargeLabel(
  cents: number | null | undefined,
): string | null {
  if (cents == null || cents <= 0) return null
  const euros = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, "0")
  return `+€${euros},${rest}`
}
