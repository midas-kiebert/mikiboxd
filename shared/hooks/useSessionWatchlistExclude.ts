import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_WATCHLIST_EXCLUDE_KEY = ["session", "watchlist_exclude"] as const;

export function useSessionWatchlistExclude() {
  const queryClient = useQueryClient();

  const { data } = useQuery<boolean | undefined>({
    queryKey: SESSION_WATCHLIST_EXCLUDE_KEY,
    queryFn: () =>
      queryClient.getQueryData<boolean>(SESSION_WATCHLIST_EXCLUDE_KEY),
    initialData: () =>
      queryClient.getQueryData<boolean>(SESSION_WATCHLIST_EXCLUDE_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelection = useCallback(
    (next: boolean) => {
      queryClient.setQueryData(SESSION_WATCHLIST_EXCLUDE_KEY, next);
    },
    [queryClient]
  );

  return { selection: Boolean(data), setSelection };
}
