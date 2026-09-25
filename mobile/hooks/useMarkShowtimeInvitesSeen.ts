/**
 * Marks the invites for one screening as seen, the moment it is opened.
 *
 * Unseen invites are counted in two places, the Activity tab badge and the
 * bell, and both count the same rows (`ShowtimePing.seen_at`). So one call
 * clears the screening from both. The card's own "unseen" dot is cleared in the
 * cached feeds straight away rather than after a refetch, so it disappears as
 * the sheet opens.
 */
import { useCallback } from "react";
import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { MeService, type ShowtimePublic } from "shared";

const clearUnseenInvite = (
  data: InfiniteData<ShowtimePublic[]> | undefined,
  showtimeId: number
): InfiniteData<ShowtimePublic[]> | undefined => {
  if (!data || !Array.isArray(data.pages)) return data;
  let changed = false;
  const pages = data.pages.map((page) =>
    Array.isArray(page)
      ? page.map((showtime) => {
          if (showtime?.id !== showtimeId || !showtime.viewer?.has_unseen_invite) return showtime;
          changed = true;
          return { ...showtime, viewer: { ...showtime.viewer, has_unseen_invite: false } };
        })
      : page
  );
  return changed ? { ...data, pages } : data;
};

export function useMarkShowtimeInvitesSeen(): (showtime: ShowtimePublic) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (showtime: ShowtimePublic) => {
      if (!showtime.viewer?.has_unseen_invite) return;
      queryClient.setQueriesData<InfiniteData<ShowtimePublic[]>>(
        { queryKey: ["showtimes"] },
        (data) => clearUnseenInvite(data, showtime.id)
      );
      MeService.markMyShowtimePingsSeenForShowtime({ showtimeId: showtime.id })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
          queryClient.invalidateQueries({ queryKey: ["me", "notifications"] });
        })
        .catch((error: unknown) => {
          console.error("Error marking a screening's invites as seen:", error);
        });
    },
    [queryClient]
  );
}
