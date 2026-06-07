import { UseQueryResult, useQuery } from "@tanstack/react-query";

import { MeGetMyUnseenNotificationCountResponse, MeService } from "../client";

type UseFetchNotificationUnseenCountProps = {
  enabled?: boolean;
  refetchIntervalMs?: number | false;
};

export function useFetchNotificationUnseenCount(
  { enabled = true, refetchIntervalMs = 15000 }: UseFetchNotificationUnseenCountProps = {}
): UseQueryResult<MeGetMyUnseenNotificationCountResponse, Error> {
  return useQuery<MeGetMyUnseenNotificationCountResponse, Error>({
    queryKey: ["me", "notifications", "unseenCount"],
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: enabled ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    queryFn: () => MeService.getMyUnseenNotificationCount(),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}
