import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_CINEMA_SELECTIONS_KEY = ["session", "cinema_selections"] as const;

export function useSessionCinemaSelections() {
  const queryClient = useQueryClient();

  const { data } = useQuery<number[] | undefined>({
    queryKey: SESSION_CINEMA_SELECTIONS_KEY,
    queryFn: async () =>
      queryClient.getQueryData(SESSION_CINEMA_SELECTIONS_KEY) as number[] | undefined,
    initialData: () =>
      queryClient.getQueryData(SESSION_CINEMA_SELECTIONS_KEY) as number[] | undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelections = useCallback(
    (next: number[]) => {
      queryClient.setQueryData(SESSION_CINEMA_SELECTIONS_KEY, next);
    },
    [queryClient]
  );

  return { selections: data, setSelections };
}
