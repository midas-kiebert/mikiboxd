import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_WATCHED_ONLY_KEY = ["session", "watched_only"] as const;

export function useSessionWatchedOnly() {
  const queryClient = useQueryClient();

  const { data } = useQuery<boolean | undefined>({
    queryKey: SESSION_WATCHED_ONLY_KEY,
    queryFn: () => queryClient.getQueryData<boolean>(SESSION_WATCHED_ONLY_KEY),
    initialData: () =>
      queryClient.getQueryData<boolean>(SESSION_WATCHED_ONLY_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelection = useCallback(
    (next: boolean) => {
      queryClient.setQueryData(SESSION_WATCHED_ONLY_KEY, next);
    },
    [queryClient]
  );

  return { selection: Boolean(data), setSelection };
}
