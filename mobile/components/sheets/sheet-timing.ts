/**
 * The one clock every bottom sheet in the app runs on.
 *
 * Kept in its own module rather than next to the sheet or the hook that uses
 * it because all three need it — {@link ./AppBottomSheet} to animate,
 * {@link ./use-sheet-content-ready} to time the open, and
 * {@link ./SheetLoadingPanel} to fade over it — and importing it from any one
 * of them would close a cycle through the other two, which for a module-scope
 * constant means reading `undefined` on whichever side loads first.
 */

/** How long every sheet takes to rise, and to sink again. */
export const SHEET_OPEN_DURATION_MS = 220;

/**
 * How long a sheet holds its content back for.
 *
 * The rise plus a couple of frames: `present()` runs its `snapToIndex` inside a
 * `requestAnimationFrame`, so the movement starts slightly after the flag that
 * schedules this one flips.
 */
export const SHEET_CONTENT_MOUNT_DELAY_MS = SHEET_OPEN_DURATION_MS + 60;

/**
 * How long a sheet's content takes to cross-fade in over the loading panel.
 *
 * Short: this is not meant to be seen as an animation, only to take the edge
 * off a hard swap. It costs the open nothing — it starts *after* the content
 * has committed, so the content is on screen for the whole of it either way,
 * and it runs on the native driver so the commit cannot stall it.
 */
export const SHEET_CONTENT_FADE_MS = 160;
