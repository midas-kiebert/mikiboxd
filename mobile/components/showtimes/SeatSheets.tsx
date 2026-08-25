/**
 * Holds the two seat-map sheets — the editable picker (`SeatFloorPlan`) and
 * the read-only preview (`SeatFloorPlanPreview`) — and owns which of them, if
 * either, is open.
 *
 * That ownership is the whole point of this component existing. Both sheets
 * are opened from `ShowtimeActionModal`, which is a very large tree; while
 * their `visible` flags lived in *its* state, tapping "Set your seat" (or
 * Cancel, or the seats pill) had to re-render that entire sheet before the
 * gorhom modal's own effect could run `present()`/`dismiss()`. The sheet
 * animation itself runs on the UI thread and was never the delay — the
 * blocking parent render in front of it was, on both open and close. Keeping
 * the flag down here means a tap re-renders only this small component, so the
 * animation starts on the very next commit.
 *
 * So it is driven imperatively rather than by a `visible` prop: the parent
 * holds a ref and calls `openPicker()` / `openPreview()` / `close()`. Nothing
 * about *which sheet is open* travels back up — the parent only hears from
 * these sheets when a seat is actually saved.
 */
import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useState,
} from "react";
import type { SeatFloorPlanSeatPublic } from "shared";

import SeatFloorPlan from "@/components/showtimes/SeatFloorPlan";
import SeatFloorPlanPreview from "@/components/showtimes/SeatFloorPlanPreview";
import type { SeatInputConfig } from "@/components/showtimes/seat-input";

export type SeatSheetsHandle = {
  /** The editable picker — for a viewer who is going and has a seat to set. */
  openPicker: () => void;
  /** The read-only map — for anyone just checking how full the room is. */
  openPreview: () => void;
  close: () => void;
};

type SeatSheetsProps = {
  room: string | null;
  seats: SeatFloorPlanSeatPublic[] | null;
  isLoadingFloorPlan: boolean;
  isFloorPlanError: boolean;
  cinemaName: string | null;
  movieTitle: string | null;
  dateLabel: string | null;
  timeRangeLabel: string | null;
  savedSeatRow: string | null;
  savedSeatNumber: string | null;
  seatInputConfig: SeatInputConfig;
  isSaving: boolean;
  onSaveSeat: (seat: { seatRow: string | null; seatNumber: string | null }) => void;
};

type OpenSheet = "picker" | "preview" | null;

// Memoized so an unrelated re-render of the showtime sheet (a status change, a
// poll landing, typing in the invite search) doesn't walk the picker's seat
// grid again while it's open.
const SeatSheets = memo(
  forwardRef<SeatSheetsHandle, SeatSheetsProps>(function SeatSheets(
    {
      room,
      seats,
      isLoadingFloorPlan,
      isFloorPlanError,
      cinemaName,
      movieTitle,
      dateLabel,
      timeRangeLabel,
      savedSeatRow,
      savedSeatNumber,
      seatInputConfig,
      isSaving,
      onSaveSeat,
    },
    ref
  ) {
    const [openSheet, setOpenSheet] = useState<OpenSheet>(null);

    const close = useCallback(() => setOpenSheet(null), []);

    useImperativeHandle(
      ref,
      () => ({
        openPicker: () => setOpenSheet("picker"),
        openPreview: () => setOpenSheet("preview"),
        close,
      }),
      [close]
    );

    const handleSave = useCallback(
      (seat: { seatRow: string | null; seatNumber: string | null }) => {
        setOpenSheet(null);
        // Deferred a frame on purpose. Saving runs a mutation whose optimistic
        // write re-renders the whole showtime sheet; batched together with the
        // close above, that render would land in front of the sheet's
        // `dismiss()` and delay the close animation by exactly the amount this
        // component exists to avoid. One frame is enough for the close to have
        // been committed and started.
        requestAnimationFrame(() => onSaveSeat(seat));
      },
      [onSaveSeat]
    );

    return (
      <>
        {/* Visual floor plan (only the cinemas we've ingested one for) */}
        <SeatFloorPlan
          visible={openSheet === "picker"}
          room={room}
          seats={seats}
          isLoading={openSheet === "picker" && isLoadingFloorPlan}
          isError={isFloorPlanError}
          cinemaName={cinemaName}
          movieTitle={movieTitle}
          dateLabel={dateLabel}
          timeRangeLabel={timeRangeLabel}
          savedSeatRow={savedSeatRow}
          savedSeatNumber={savedSeatNumber}
          seatInputConfig={seatInputConfig}
          isSaving={isSaving}
          onSave={handleSave}
          onCancel={close}
        />

        {/* Read-only preview, opened from the "available seats" pill — same
            underlying data, no editing surface. */}
        <SeatFloorPlanPreview
          visible={openSheet === "preview"}
          room={room}
          seats={seats}
          isLoading={openSheet === "preview" && isLoadingFloorPlan}
          cinemaName={cinemaName}
          movieTitle={movieTitle}
          dateLabel={dateLabel}
          timeRangeLabel={timeRangeLabel}
          onClose={close}
        />
      </>
    );
  })
);

export default SeatSheets;
