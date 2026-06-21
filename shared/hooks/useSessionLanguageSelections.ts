import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Language } from "../client";

const SESSION_LANGUAGE_SELECTIONS_KEY = ["session", "language_selections"] as const;

export function useSessionLanguageSelections() {
  const queryClient = useQueryClient();

  const { data } = useQuery<Language[] | undefined>({
    queryKey: SESSION_LANGUAGE_SELECTIONS_KEY,
    queryFn: () =>
      queryClient.getQueryData<Language[]>(SESSION_LANGUAGE_SELECTIONS_KEY),
    initialData: () =>
      queryClient.getQueryData<Language[]>(SESSION_LANGUAGE_SELECTIONS_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelections = useCallback(
    (next: Language[]) => {
      queryClient.setQueryData(SESSION_LANGUAGE_SELECTIONS_KEY, next);
    },
    [queryClient]
  );

  return { selections: data, setSelections };
}
