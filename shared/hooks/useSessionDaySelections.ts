import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_DAY_SELECTIONS_KEY = ["session", "day_selections"] as const;

export function useSessionDaySelections() {
  const queryClient = useQueryClient();

  const { data } = useQuery<string[] | undefined>({
    queryKey: SESSION_DAY_SELECTIONS_KEY,
    queryFn: () => queryClient.getQueryData<string[]>(SESSION_DAY_SELECTIONS_KEY),
    initialData: () => queryClient.getQueryData<string[]>(SESSION_DAY_SELECTIONS_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelections = useCallback(
    (next: string[]) => {
      queryClient.setQueryData(SESSION_DAY_SELECTIONS_KEY, next);
    },
    [queryClient]
  );

  return { selections: data, setSelections };
}
