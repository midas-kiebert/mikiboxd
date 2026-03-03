import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OpenAPI, type ShowtimeVisibilityPublic } from "shared";
import { storage } from "shared/storage";

const MAX_SHOWTIME_IDS_PER_BATCH = 100;

const buildVisibilityBatchUrl = (showtimeIds: number[]): string => {
  const query = showtimeIds
    .map((showtimeId) => `showtime_ids=${encodeURIComponent(String(showtimeId))}`)
    .join("&");
  return `${OpenAPI.BASE}/api/v1/showtimes/visibility/batch${query ? `?${query}` : ""}`;
};

type UsePrefetchShowtimeVisibilityBatchProps = {
  showtimeIds: number[];
  enabled?: boolean;
};

export const usePrefetchShowtimeVisibilityBatch = ({
  showtimeIds,
  enabled = true,
}: UsePrefetchShowtimeVisibilityBatchProps) => {
  const queryClient = useQueryClient();
  const dedupedShowtimeIds = useMemo(
    () =>
      Array.from(
        new Set(showtimeIds.filter((showtimeId) => Number.isInteger(showtimeId) && showtimeId > 0))
      ).slice(0, MAX_SHOWTIME_IDS_PER_BATCH),
    [showtimeIds]
  );

  const query = useQuery<ShowtimeVisibilityPublic[], Error>({
    queryKey: ["showtimes", "visibilityBatch", dedupedShowtimeIds],
    enabled: enabled && dedupedShowtimeIds.length > 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const token = await storage.getItem("access_token");
      const response = await fetch(buildVisibilityBatchUrl(dedupedShowtimeIds), {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch showtime visibility batch (${response.status})`);
      }
      return (await response.json()) as ShowtimeVisibilityPublic[];
    },
  });

  useEffect(() => {
    if (!query.data) {
      return;
    }
    for (const visibility of query.data) {
      queryClient.setQueryData(
        ["showtimes", "visibility", visibility.showtime_id],
        visibility
      );
    }
  }, [query.data, queryClient]);

  return query;
};
