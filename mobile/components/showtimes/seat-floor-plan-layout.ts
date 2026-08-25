/**
 * Scales a room's raw seat geometry (desktop-booking-page pixel coordinates)
 * to fit a device screen, preserving the room's true proportions.
 *
 * Kept free of React Native so the bounding-box/scale math is plain and
 * testable — `SeatFloorPlan` is the only caller.
 */
import type { SeatFloorPlanSeatPublic } from "shared";

export type ScaledSeat = SeatFloorPlanSeatPublic & {
  x: number;
  y: number;
  scaledWidth: number;
  scaledHeight: number;
};

export type SeatFloorPlanLayout = {
  seats: ScaledSeat[];
  /** The scaled room's own footprint, for centering/sizing its container. */
  width: number;
  height: number;
};

// Leaves room for the header/close button and screen edges — a floor plan
// that touched the device edges would read as cramped and be hard to tap
// near the border.
const FIT_PADDING_FACTOR = 0.9;

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
  // reads as wide and shallow rather than being squashed to fit.
  const scale = Math.min(
    (availableWidth * FIT_PADDING_FACTOR) / boundingWidth,
    (availableHeight * FIT_PADDING_FACTOR) / boundingHeight
  );

  const scaledSeats = seats.map((seat) => ({
    ...seat,
    x: (seat.position_left - minLeft) * scale,
    y: (seat.position_top - minTop) * scale,
    scaledWidth: Math.max(seat.width * scale, 1),
    scaledHeight: Math.max(seat.height * scale, 1),
  }));

  return {
    seats: scaledSeats,
    width: boundingWidth * scale,
    height: boundingHeight * scale,
  };
}
