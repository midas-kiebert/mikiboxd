/**
 * The cheap, defensible fix for `RESPONSIVE_AUDIT.md` finding 16 ("everything
 * stretches to full width on a tablet") — `ios.supportsTablet: true` in
 * `app.json` ships the phone layout at iPad width today, which a reviewer
 * running on an iPad (the August 2026 rejection's device) sees as an
 * unfinished screen: a 74pt date column and a 72pt poster in a 736pt-wide row,
 * ~570pt of empty space holding a 15pt title.
 *
 * `640` centers the content at a comfortable reading width and leaves the rest
 * of the screen as margin rather than stretched cards. The audit's own "good
 * version" — a two-column master/detail layout — is a real restructuring left
 * for a deliberate tablet pass; this is the floor that stops the layout
 * reading as broken in the meantime.
 */
export const TABLET_CONTENT_MAX_WIDTH = 640;

export const tabletCappedContentStyle = {
  width: "100%" as const,
  maxWidth: TABLET_CONTENT_MAX_WIDTH,
  alignSelf: "center" as const,
};
