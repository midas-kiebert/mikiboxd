import { UseQueryResult, useQuery } from "@tanstack/react-query";

import { MeGetMyNotificationsResponse, MeService } from "../client";

type UseFetchNotificationsProps = {
  enabled?: boolean;
  limit?: number;
  offset?: number;
  refetchIntervalMs?: number | false;
};

export function useFetchNotifications(
  {
    enabled = true,
    limit = 50,
    offset = 0,
    refetchIntervalMs = 30000,
  }: UseFetchNotificationsProps = {}
): UseQueryResult<MeGetMyNotificationsResponse, Error> {
  return useQuery<MeGetMyNotificationsResponse, Error>({
    queryKey: ["me", "notifications", { limit, offset }],
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: enabled ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    queryFn: () => MeService.getMyNotifications({ limit, offset }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}
