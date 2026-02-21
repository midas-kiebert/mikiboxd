import { UseQueryResult, useQuery } from "@tanstack/react-query";

import { MeGetMyUnseenShowtimePingCountResponse, MeService } from "../client";

type UseFetchUnseenShowtimePingCountProps = {
  enabled?: boolean;
  refetchIntervalMs?: number | false;
};

export function useFetchUnseenShowtimePingCount(
  { enabled = true, refetchIntervalMs = 15000 }: UseFetchUnseenShowtimePingCountProps = {}
): UseQueryResult<MeGetMyUnseenShowtimePingCountResponse, Error> {
  return useQuery<MeGetMyUnseenShowtimePingCountResponse, Error>({
    queryKey: ["me", "showtimePings", "unseenCount"],
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: enabled ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    queryFn: () => MeService.getMyUnseenShowtimePingCount(),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}
