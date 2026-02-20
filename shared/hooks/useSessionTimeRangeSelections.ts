import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_TIME_RANGE_SELECTIONS_KEY = ["session", "time_range_selections"] as const;

export function useSessionTimeRangeSelections() {
  const queryClient = useQueryClient();

  const { data } = useQuery<string[] | undefined>({
    queryKey: SESSION_TIME_RANGE_SELECTIONS_KEY,
    queryFn: () =>
      queryClient.getQueryData<string[]>(SESSION_TIME_RANGE_SELECTIONS_KEY),
    initialData: () =>
      queryClient.getQueryData<string[]>(SESSION_TIME_RANGE_SELECTIONS_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelections = useCallback(
    (next: string[]) => {
      queryClient.setQueryData(SESSION_TIME_RANGE_SELECTIONS_KEY, next);
    },
    [queryClient]
  );

  return { selections: data, setSelections };
}
