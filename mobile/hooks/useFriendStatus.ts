/**
 * Live-ish friendship/request status for a single user, seeded from whatever
 * snapshot the caller already has (e.g. a showtime's embedded participant
 * list) and then kept fresh with a light poll.
 *
 * Several screens embed a `UserWithFriendStatus` snapshot inside a larger,
 * imperatively-fetched payload (a showtime modal's "Invited" list is the
 * motivating case) that never gets refetched on its own. Without this, a
 * status change made from the *other* side — they declined your request,
 * they also requested you and the pair auto-resolved to friends, etc. —
 * never reaches a screen that only re-renders when its own mutations settle.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UsersService, type UserWithFriendStatus } from "shared";

const FRIEND_STATUS_POLL_INTERVAL_MS = 10000;

export function useFriendStatus(seed: UserWithFriendStatus) {
  return useQuery({
    queryKey: ["users", "friendStatus", seed.id],
    queryFn: () => UsersService.getUserFriendStatus({ userId: seed.id }),
    initialData: seed,
    refetchInterval: FRIEND_STATUS_POLL_INTERVAL_MS,
    refetchOnMount: "always",
  });
}

/**
 * Pairs `useFriendStatus` with a local "just tapped" override so a button can
 * paint instantly, then drops the override the moment any fresh fetch lands —
 * whether that confirms the tap or reverts it (the mutation failed, or the
 * other side changed something first) — since a completed round trip is
 * always more trustworthy than a guess made before it resolved.
 */
export function useOptimisticFriendStatus<T>(seed: UserWithFriendStatus) {
  const query = useFriendStatus(seed);
  const [override, setOverride] = useState<T | null>(null);
  const lastDataUpdatedAtRef = useRef(query.dataUpdatedAt);

  useEffect(() => {
    if (query.dataUpdatedAt !== lastDataUpdatedAtRef.current) {
      lastDataUpdatedAtRef.current = query.dataUpdatedAt;
      setOverride(null);
    }
  }, [query.dataUpdatedAt]);

  return { user: query.data, override, setOverride };
}
