import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_HIDE_WATCHED_KEY = ["session", "hide_watched"] as const;

export function useSessionHideWatched() {
  const queryClient = useQueryClient();

  const { data } = useQuery<boolean | undefined>({
    queryKey: SESSION_HIDE_WATCHED_KEY,
    queryFn: () => queryClient.getQueryData<boolean>(SESSION_HIDE_WATCHED_KEY),
    initialData: () => queryClient.getQueryData<boolean>(SESSION_HIDE_WATCHED_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelection = useCallback(
    (next: boolean) => {
      queryClient.setQueryData(SESSION_HIDE_WATCHED_KEY, next);
    },
    [queryClient]
  );

  return {
    selection: Boolean(data),
    setSelection,
  };
}
