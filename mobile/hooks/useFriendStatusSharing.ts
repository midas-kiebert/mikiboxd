/**
 * Per-friend "who can see my showtimes" writes, made safe to hammer.
 *
 * Each write makes the backend rebuild every effective-visibility row the user
 * owns, so overlapping requests are both slow and prone to colliding. This hook
 * therefore keeps the tapped value locally, debounces the request, and never
 * lets more than one be in flight: a tap during a write is applied after that
 * write settles, so the last value the user picked is always the one stored.
 *
 * The locally desired value also wins over server data until the server agrees
 * with it, which is what stops the control snapping back and forth while the
 * invalidated friends query refetches.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { FriendsService } from "shared";

/** Rapid taps collapse into a single request once the user pauses this long. */
const WRITE_DEBOUNCE_MS = 450;

export type FriendStatusSharing = {
  /** What to paint: the tapped value until the server confirms it. */
  sharesStatus: boolean;
  change: (sharesStatus: boolean) => void;
};

export function useFriendStatusSharing(
  friendId: string,
  serverValue: boolean
): FriendStatusSharing {
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // The value the user asked for, held until the server confirms it. Null = settled.
  const [desiredValue, setDesiredValue] = useState<boolean | null>(null);
  // Bumped whenever a write settles so the scheduling effect re-evaluates.
  const [settledWrites, setSettledWrites] = useState(0);
  const isWritingRef = useRef(false);
  // Last value successfully stored, kept until the refetch reflects it.
  const lastWrittenRef = useRef<boolean | null>(null);

  const write = useCallback(
    async (sharesStatus: boolean) => {
      isWritingRef.current = true;
      try {
        await FriendsService.setFriendStatusSharing({
          friendId,
          requestBody: { shares_status: sharesStatus },
        });
        lastWrittenRef.current = sharesStatus;
        queryClient.invalidateQueries({ queryKey: ["users"] });
        // Visibility of your status to this friend may have changed.
        queryClient.invalidateQueries({ queryKey: ["showtimes"] });
        queryClient.invalidateQueries({ queryKey: ["movie"] });
        queryClient.invalidateQueries({ queryKey: ["movies"] });
      } catch (error) {
        console.error("Error updating status sharing:", error);
        Alert.alert("Error", "Could not update who can see your showtimes.");
        // Drop the local intent so the control falls back to the stored value.
        lastWrittenRef.current = null;
        setDesiredValue(null);
      } finally {
        isWritingRef.current = false;
        setSettledWrites((count) => count + 1);
      }
    },
    [friendId, queryClient]
  );

  useEffect(() => {
    if (desiredValue === null) return;

    const isStored = lastWrittenRef.current === null || lastWrittenRef.current === desiredValue;
    if (!isWritingRef.current && isStored && serverValue === desiredValue) {
      // The server agrees with the user — hand display back to the query data.
      lastWrittenRef.current = null;
      setDesiredValue(null);
      return;
    }

    // A write is in flight, or the value is already stored and we are just
    // waiting for the refetch. Either way this effect re-runs when that settles.
    if (isWritingRef.current || lastWrittenRef.current === desiredValue) return;

    const timer = setTimeout(() => void write(desiredValue), WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [desiredValue, serverValue, settledWrites, write]);

  const change = useCallback((sharesStatus: boolean) => setDesiredValue(sharesStatus), []);

  return { sharesStatus: desiredValue ?? serverValue, change };
}
