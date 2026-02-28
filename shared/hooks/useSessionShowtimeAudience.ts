import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type SessionShowtimeAudience = "including-friends" | "only-you";

const SESSION_SHOWTIME_AUDIENCE_KEY = ["session", "showtime_audience"] as const;
const DEFAULT_SHOWTIME_AUDIENCE: SessionShowtimeAudience = "including-friends";

const normalizeShowtimeAudience = (
  value: SessionShowtimeAudience | undefined
): SessionShowtimeAudience => {
  if (value === "including-friends" || value === "only-you") return value;
  return DEFAULT_SHOWTIME_AUDIENCE;
};

export function useSessionShowtimeAudience() {
  const queryClient = useQueryClient();

  const { data } = useQuery<SessionShowtimeAudience | undefined>({
    queryKey: SESSION_SHOWTIME_AUDIENCE_KEY,
    queryFn: () =>
      queryClient.getQueryData<SessionShowtimeAudience>(SESSION_SHOWTIME_AUDIENCE_KEY),
    initialData: () =>
      queryClient.getQueryData<SessionShowtimeAudience>(SESSION_SHOWTIME_AUDIENCE_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelection = useCallback(
    (next: SessionShowtimeAudience) => {
      queryClient.setQueryData(SESSION_SHOWTIME_AUDIENCE_KEY, next);
    },
    [queryClient]
  );

  return {
    selection: normalizeShowtimeAudience(data),
    setSelection,
  };
}
