/**
 * Layout-level provider that keeps one ShowtimeActionModal mounted and lets any
 * screen open it through the useShowtimeModal() hook.
 *
 * It owns the showtime currently shown, the (optional) invite context, and the
 * single status-update + invite-dismiss mutations — consolidating logic that used
 * to be copy-pasted in every screen that opened the modal.
 *
 * Open it with:
 *  - openShowtimeModal(showtime)         already-loaded ShowtimeLoggedIn
 *  - openShowtimeModalById(showtimeId)   fetches by id (deep links, notifications)
 *  - openShowtimeModalForInvite(group)   from a ping (shows "Invited by …")
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MeService,
  ShowtimesService,
  type GoingStatus,
  type ShowtimeLoggedIn,
  type UserPublic,
} from "shared";

import ShowtimeActionModal, { type ShowtimeInvite } from "@/components/showtimes/ShowtimeActionModal";

export type OpenOptions = {
  invite?: ShowtimeInvite | null;
  openedFrom?: { movieId?: number; cinemaId?: number; userId?: string };
};

type ShowtimeModalContextValue = {
  openShowtimeModal: (showtime: ShowtimeLoggedIn, options?: OpenOptions) => void;
  openShowtimeModalById: (showtimeId: number, options?: OpenOptions) => void;
  openShowtimeModalForInvite: (args: {
    showtime: ShowtimeLoggedIn;
    senders: UserPublic[];
    pingIds: number[];
  }) => void;
};

const ShowtimeModalContext = createContext<ShowtimeModalContextValue>({
  openShowtimeModal: () => {},
  openShowtimeModalById: () => {},
  openShowtimeModalForInvite: () => {},
});

export function useShowtimeModal() {
  return useContext(ShowtimeModalContext);
}

export function ShowtimeModalProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [currentShowtime, setCurrentShowtime] = useState<ShowtimeLoggedIn | null>(null);
  const [invite, setInvite] = useState<ShowtimeInvite | null>(null);
  const [openedFrom, setOpenedFrom] = useState<OpenOptions["openedFrom"]>(undefined);
  const [isLoadingById, setIsLoadingById] = useState(false);
  // Guards against a slow getShowtimeById resolving after a newer open superseded it.
  const openRequestIdRef = useRef(0);

  const openShowtimeModal = useCallback(
    (showtime: ShowtimeLoggedIn, options?: OpenOptions) => {
      openRequestIdRef.current += 1;
      setInvite(options?.invite ?? null);
      setOpenedFrom(options?.openedFrom);
      setCurrentShowtime(showtime);
      setIsLoadingById(false);
      setVisible(true);
    },
    []
  );

  const openShowtimeModalById = useCallback(
    (showtimeId: number, options?: OpenOptions) => {
      const requestId = ++openRequestIdRef.current;
      setInvite(options?.invite ?? null);
      setOpenedFrom(options?.openedFrom);
      setCurrentShowtime(null);
      setIsLoadingById(true);
      setVisible(true);
      void (async () => {
        try {
          const fetched = await ShowtimesService.getShowtimeById({ showtimeId });
          if (openRequestIdRef.current !== requestId) return;
          setCurrentShowtime(fetched);
        } catch (error) {
          if (openRequestIdRef.current !== requestId) return;
          console.error("Error loading showtime for modal:", error);
          Alert.alert("Error", "Could not open this showtime.");
          setVisible(false);
        } finally {
          if (openRequestIdRef.current === requestId) setIsLoadingById(false);
        }
      })();
    },
    []
  );

  const openShowtimeModalForInvite = useCallback(
    ({
      showtime,
      senders,
      pingIds,
    }: {
      showtime: ShowtimeLoggedIn;
      senders: UserPublic[];
      pingIds: number[];
    }) => {
      openShowtimeModal(showtime, { invite: { senders, pingIds } });
    },
    [openShowtimeModal]
  );

  const { mutate: updateShowtimeSelection, isPending: isUpdatingStatus } = useMutation({
    mutationFn: ({
      showtimeId,
      going,
      seatRow,
      seatNumber,
    }: {
      showtimeId: number;
      going: GoingStatus;
      seatRow?: string | null;
      seatNumber?: string | null;
    }) => {
      const requestBody: {
        going_status: GoingStatus;
        seat_row?: string | null;
        seat_number?: string | null;
      } = { going_status: going };
      if (seatRow !== undefined) requestBody.seat_row = seatRow;
      if (seatNumber !== undefined) requestBody.seat_number = seatNumber;
      return ShowtimesService.updateShowtimeSelection({ showtimeId, requestBody });
    },
    onSuccess: (updatedShowtime) => {
      setCurrentShowtime((previous) =>
        previous && previous.id === updatedShowtime.id ? updatedShowtime : previous
      );
    },
    onError: (error) => {
      console.error("Error updating showtime selection:", error);
    },
    onSettled: () => {
      // Broad invalidation refreshes every screen that lists this showtime.
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
    },
  });

  const handleUpdateStatus = useCallback(
    (going: GoingStatus, seat?: { seatRow: string | null; seatNumber: string | null }) => {
      if (!currentShowtime || isUpdatingStatus) return;
      const nextSeatRow =
        going === "GOING" ? (seat?.seatRow ?? currentShowtime.seat_row ?? null) : null;
      const nextSeatNumber =
        going === "GOING" ? (seat?.seatNumber ?? currentShowtime.seat_number ?? null) : null;
      // Optimistic update so the sheet reflects the new status immediately.
      setCurrentShowtime((previous) =>
        previous ? { ...previous, going, seat_row: nextSeatRow, seat_number: nextSeatNumber } : previous
      );
      updateShowtimeSelection({
        showtimeId: currentShowtime.id,
        going,
        seatRow: seat?.seatRow,
        seatNumber: seat?.seatNumber,
      });
    },
    [currentShowtime, isUpdatingStatus, updateShowtimeSelection]
  );

  const { mutate: dismissInvitePings, isPending: isDismissingInvite } = useMutation({
    mutationFn: async ({ pingIds }: { pingIds: number[] }) => {
      for (const pingId of pingIds) {
        try {
          await MeService.dismissMyShowtimePing({ pingId });
        } catch (error) {
          const status =
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof (error as { status?: unknown }).status === "number"
              ? (error as { status: number }).status
              : undefined;
          if (status === 404) continue;
          throw error;
        }
      }
    },
    onError: (error) => {
      console.error("Error dismissing invite:", error);
      Alert.alert("Error", "Could not dismiss invite.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
      // Refresh feeds so the showtime's embedded invited_by reflects the dismissal.
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
    },
  });

  // Always surface invite info: prefer an explicitly-passed invite (e.g. a ping
  // deep link), otherwise derive it from the showtime's own invited_by data so
  // the "X invited you" banner + blue tint show no matter where the modal opens.
  const effectiveInvite = useMemo<ShowtimeInvite | null>(() => {
    if (invite) return invite;
    if (currentShowtime && (currentShowtime.invited_by?.length ?? 0) > 0) {
      return {
        senders: [...(currentShowtime.invited_by ?? [])],
        pingIds: [...(currentShowtime.invite_ping_ids ?? [])],
      };
    }
    return null;
  }, [invite, currentShowtime]);

  const handleDismissInvite = useCallback(() => {
    if (!effectiveInvite || effectiveInvite.pingIds.length === 0) return;
    setVisible(false);
    dismissInvitePings({ pingIds: effectiveInvite.pingIds });
  }, [dismissInvitePings, effectiveInvite]);

  const value = useMemo<ShowtimeModalContextValue>(
    () => ({ openShowtimeModal, openShowtimeModalById, openShowtimeModalForInvite }),
    [openShowtimeModal, openShowtimeModalById, openShowtimeModalForInvite]
  );

  return (
    <ShowtimeModalContext.Provider value={value}>
      {children}
      <ShowtimeActionModal
        visible={visible}
        showtime={currentShowtime}
        isLoadingShowtime={isLoadingById}
        invite={effectiveInvite}
        isUpdatingStatus={isUpdatingStatus}
        isDismissingInvite={isDismissingInvite}
        onUpdateStatus={handleUpdateStatus}
        onDismissInvite={handleDismissInvite}
        onClose={() => setVisible(false)}
        disableMovieNavigation={openedFrom?.movieId !== undefined}
        disabledCinemaId={openedFrom?.cinemaId}
        disabledUserId={openedFrom?.userId}
      />
    </ShowtimeModalContext.Provider>
  );
}
