import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_WATCHLIST_ONLY_KEY = ["session", "watchlist_only"] as const;

export function useSessionWatchlistOnly() {
  const queryClient = useQueryClient();

  const { data } = useQuery<boolean | undefined>({
    queryKey: SESSION_WATCHLIST_ONLY_KEY,
    queryFn: () => queryClient.getQueryData<boolean>(SESSION_WATCHLIST_ONLY_KEY),
    initialData: () => queryClient.getQueryData<boolean>(SESSION_WATCHLIST_ONLY_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelection = useCallback(
    (next: boolean) => {
      queryClient.setQueryData(SESSION_WATCHLIST_ONLY_KEY, next);
    },
    [queryClient]
  );

  return {
    selection: Boolean(data),
    setSelection,
  };
}
