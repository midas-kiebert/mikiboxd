/**
 * Scales a room's raw seat geometry (desktop-booking-page pixel coordinates)
 * to fit a device screen, preserving the room's true proportions — and, past
 * a point, declining to fill the space at all (see `MAX_RENDERED_SEAT_SIZE`).
 *
 * Kept free of React Native so the bounding-box/scale math is plain and
 * testable. Both seat sheets share it — `SeatFloorPlan` (the picker) and
 * `SeatFloorPlanPreview` (the read-only map) — which is what keeps a room the
 * same size in each.
 */
import type { SeatFloorPlanSeatPublic } from "shared";

export type ScaledSeat = SeatFloorPlanSeatPublic & {
  x: number;
  y: number;
  scaledWidth: number;
  scaledHeight: number;
  /** Extra tap area on each side, restoring the pre-inset slot as the hit target. */
  hitSlopX: number;
  hitSlopY: number;
};

export type SeatFloorPlanLayout = {
  seats: ScaledSeat[];
  /** The scaled room's own footprint, for centering/sizing its container. */
  width: number;
  height: number;
};

// Leaves a little room so the floor plan doesn't touch the screen edges —
// kept close to 1 so small rooms (few seats, so a small bounding box) still
// render at a legible size rather than shrinking further than the space
// actually available.
const FIT_PADDING_FACTOR = 0.97;

// A ceiling on how big one seat may be drawn, and so on the scale itself.
//
// Fitting a room to the space available is the right rule right up until the
// room is small, at which point it stops meaning "as big as it needs to be"
// and starts meaning "as big as the sheet will allow". A 31-seat Cinecenter
// room fitted to a phone gives seats near 40pt — twice a 256-seat Filmhallen
// room's, for a room a fraction of the size — which reads as a zoomed-in
// fragment rather than a floor plan, and leaves the SCREEN bar looking like a
// stray line under a wall of blocks. Capping the scale keeps a small room
// looking small and, more usefully, keeps a seat roughly the same size in
// every room, so the maps are comparable to each other.
//
// It only ever binds on rooms the available space would have oversized; every
// room big enough to be fit-constrained is untouched.
const MAX_RENDERED_SEAT_SIZE = 24;

// Vertical space reserved above the seat grid for the "SCREEN" bar rendered
// by both `SeatFloorPlan` and `SeatFloorPlanPreview` (see `ScreenIndicator`
// in `SeatFloorPlan.tsx`) — there's no screen geometry from the cinema's own
// data, this is purely an orientation cue, so its height is fixed rather than
// derived from the room. Must stay in step with that component's own styles.
export const SCREEN_INDICATOR_HEIGHT = 28;

// Shrink every seat toward its own center by this fraction, regardless of how
// tightly the source cinema packed its own grid. Some rooms (Filmhallen) leave
// a slot of daylight between seats in the raw pixel data; others (Louis
// Hartlooper) define seats exactly pitch-to-pitch with zero native gap, which
// renders as one solid, unreadable block without this. A proportional inset
// keeps the effect consistent across both.
const SEAT_INSET_FACTOR = 0.16;
// Never shrink a seat past this, even at a tiny scale — a gap nobody can see
// isn't worth a seat nobody can tap.
const MIN_RENDERED_SEAT_SIZE = 4;
// The inset above shrinks the *visible* seat for spacing, but the tap target
// shouldn't shrink with it — a few extra missed taps aren't worth the
// legibility, so hitSlop always restores at least this much on every side,
// on top of whatever the inset itself already gives back.
const MIN_HIT_SLOP = 6;

export function layoutSeatFloorPlan(
  seats: SeatFloorPlanSeatPublic[],
  { availableWidth, availableHeight }: { availableWidth: number; availableHeight: number }
): SeatFloorPlanLayout {
  if (seats.length === 0) {
    return { seats: [], width: 0, height: 0 };
  }

  const minLeft = Math.min(...seats.map((seat) => seat.position_left));
  const minTop = Math.min(...seats.map((seat) => seat.position_top));
  const maxRight = Math.max(...seats.map((seat) => seat.position_left + seat.width));
  const maxBottom = Math.max(...seats.map((seat) => seat.position_top + seat.height));
  const boundingWidth = Math.max(maxRight - minLeft, 1);
  const boundingHeight = Math.max(maxBottom - minTop, 1);

  // Uniform scale (not stretched per axis) so a wide, shallow room still
  // reads as wide and shallow rather than being squashed to fit. The screen
  // indicator sits above the grid within the same available height, so the
  // seats must scale to fit what's left after it, not the full body.
  const availableHeightForSeats = Math.max(availableHeight - SCREEN_INDICATOR_HEIGHT, 1);
  // Seat boxes are uniform within a room, so one seat's is the whole room's.
  const seatBoxSize = Math.max(...seats.map((seat) => Math.max(seat.width, seat.height)), 1);
  const scale = Math.min(
    (availableWidth * FIT_PADDING_FACTOR) / boundingWidth,
    (availableHeightForSeats * FIT_PADDING_FACTOR) / boundingHeight,
    MAX_RENDERED_SEAT_SIZE / seatBoxSize
  );

  const scaledSeats = seats.map((seat) => {
    const rawWidth = seat.width * scale;
    const rawHeight = seat.height * scale;
    const scaledWidth = Math.max(rawWidth * (1 - SEAT_INSET_FACTOR), Math.min(rawWidth, MIN_RENDERED_SEAT_SIZE));
    const scaledHeight = Math.max(rawHeight * (1 - SEAT_INSET_FACTOR), Math.min(rawHeight, MIN_RENDERED_SEAT_SIZE));
    return {
      ...seat,
      // Centered on the seat's original slot, so insetting doesn't drift the
      // grid — only the gaps between seats grow.
      x: (seat.position_left - minLeft) * scale + (rawWidth - scaledWidth) / 2,
      y: (seat.position_top - minTop) * scale + (rawHeight - scaledHeight) / 2,
      scaledWidth,
      scaledHeight,
      hitSlopX: Math.max((rawWidth - scaledWidth) / 2, MIN_HIT_SLOP),
      hitSlopY: Math.max((rawHeight - scaledHeight) / 2, MIN_HIT_SLOP),
    };
  });

  return {
    seats: scaledSeats,
    width: boundingWidth * scale,
    height: boundingHeight * scale,
  };
}
