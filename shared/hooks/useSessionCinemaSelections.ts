import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_CINEMA_SELECTIONS_KEY = ["session", "cinema_selections"] as const;

export function useSessionCinemaSelections() {
  const queryClient = useQueryClient();

  const { data } = useQuery<number[] | undefined>({
    queryKey: SESSION_CINEMA_SELECTIONS_KEY,
    // TanStack Query's types require a `queryFn` unless you configure a "default queryFn"
    // on the QueryClient. Even though this query is `enabled: false`, providing a small
    // queryFn avoids both runtime and TypeScript errors if someone ever calls `refetch()`
    // or flips `enabled` to `true` later.
    queryFn: () => queryClient.getQueryData<number[]>(SESSION_CINEMA_SELECTIONS_KEY),
    // When the hook mounts, seed the value from whatever is already in the cache.
    initialData: () => queryClient.getQueryData<number[]>(SESSION_CINEMA_SELECTIONS_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelections = useCallback(
    (next: number[] | undefined) => {
      queryClient.setQueryData(SESSION_CINEMA_SELECTIONS_KEY, next);
    },
    [queryClient]
  );

  return { selections: data, setSelections };
}
