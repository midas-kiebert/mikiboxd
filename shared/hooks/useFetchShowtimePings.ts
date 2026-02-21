import { UseQueryResult, useQuery } from "@tanstack/react-query";

import {
  MeGetMyShowtimePingsResponse,
  MeService,
  type ShowtimePingSort,
} from "../client";

type UseFetchShowtimePingsProps = {
  enabled?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: ShowtimePingSort;
  refetchIntervalMs?: number | false;
};

export function useFetchShowtimePings(
  {
    enabled = true,
    limit = 50,
    offset = 0,
    sortBy = "ping_created_at",
    refetchIntervalMs = 30000,
  }: UseFetchShowtimePingsProps = {}
): UseQueryResult<MeGetMyShowtimePingsResponse, Error> {
  return useQuery<MeGetMyShowtimePingsResponse, Error>({
    queryKey: ["me", "showtimePings", { limit, offset, sortBy }],
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: enabled ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    queryFn: () => MeService.getMyShowtimePings({ limit, offset, sortBy }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}
