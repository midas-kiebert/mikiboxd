import { UseQueryResult, useQuery } from "@tanstack/react-query";

import {
  MeGetMyShowtimePingsResponse,
  MeService,
} from "../client";

type UseFetchShowtimePingsProps = {
  enabled?: boolean;
  limit?: number;
  offset?: number;
  refetchIntervalMs?: number | false;
};

export function useFetchShowtimePings(
  {
    enabled = true,
    limit = 50,
    offset = 0,
    refetchIntervalMs = 30000,
  }: UseFetchShowtimePingsProps = {}
): UseQueryResult<MeGetMyShowtimePingsResponse, Error> {
  return useQuery<MeGetMyShowtimePingsResponse, Error>({
    queryKey: ["me", "showtimePings", { limit, offset }],
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: enabled ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    queryFn: () => MeService.getMyShowtimePings({ limit, offset }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}
