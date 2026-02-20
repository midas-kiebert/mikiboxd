import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type SessionShowtimeFilter = "all" | "interested" | "going";

const SESSION_SHOWTIME_FILTER_KEY = ["session", "showtime_filter"] as const;
const DEFAULT_SHOWTIME_FILTER: SessionShowtimeFilter = "all";

const normalizeShowtimeFilter = (value: SessionShowtimeFilter | undefined): SessionShowtimeFilter => {
  if (value === "all" || value === "interested" || value === "going") return value;
  return DEFAULT_SHOWTIME_FILTER;
};

export function useSessionShowtimeFilter() {
  const queryClient = useQueryClient();

  const { data } = useQuery<SessionShowtimeFilter | undefined>({
    queryKey: SESSION_SHOWTIME_FILTER_KEY,
    queryFn: () => queryClient.getQueryData<SessionShowtimeFilter>(SESSION_SHOWTIME_FILTER_KEY),
    initialData: () => queryClient.getQueryData<SessionShowtimeFilter>(SESSION_SHOWTIME_FILTER_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelection = useCallback(
    (next: SessionShowtimeFilter) => {
      queryClient.setQueryData(SESSION_SHOWTIME_FILTER_KEY, next);
    },
    [queryClient]
  );

  return {
    selection: normalizeShowtimeFilter(data),
    setSelection,
  };
}
