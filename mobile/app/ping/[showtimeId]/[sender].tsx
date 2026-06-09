/**
 * Showtime invite deep-link handler (mikino.nl/ping/{showtimeId}/{sender}).
 *
 * Instead of showing its own page, it lands the user on the home tab and opens the
 * showtime modal in place — no page-jumping. The invite is registered in the
 * background (best effort) so it also appears in the Invites list.
 */
import { useEffect, useMemo, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ShowtimesService } from "shared";

import { useShowtimeModal } from "@/components/showtimes/ShowtimeModalProvider";

export default function PingLinkScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openShowtimeModalById } = useShowtimeModal();
  const { showtimeId, sender } = useLocalSearchParams<{
    showtimeId?: string | string[];
    sender?: string | string[];
  }>();
  const handledRef = useRef(false);

  const normalizedShowtimeId = useMemo(() => {
    const value = Array.isArray(showtimeId) ? showtimeId[0] : showtimeId;
    const parsed = Number.parseInt(value?.trim() ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [showtimeId]);

  const normalizedSender = useMemo(() => {
    const value = Array.isArray(sender) ? sender[0] : sender;
    return value?.trim() ?? "";
  }, [sender]);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    // Land on home immediately; the modal opens over it (no intermediate page).
    router.replace("/(tabs)");
    if (normalizedShowtimeId === null) return;

    openShowtimeModalById(normalizedShowtimeId);

    // Register the invite in the background so it also shows up in the Invites list.
    if (normalizedSender.length > 0) {
      void (async () => {
        try {
          await ShowtimesService.receivePingFromLink({
            showtimeId: normalizedShowtimeId,
            senderIdentifier: normalizedSender,
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] }),
            queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] }),
          ]);
        } catch (error) {
          console.error("Error registering invite from link:", error);
        }
      })();
    }
  }, [normalizedSender, normalizedShowtimeId, openShowtimeModalById, queryClient, router]);

  return null;
}
