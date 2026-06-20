import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_EXCLUDE_LIST_IDS_KEY = ["session", "exclude_list_ids"] as const;

export function useSessionExcludeListIds() {
  const queryClient = useQueryClient();

  const { data } = useQuery<string[] | undefined>({
    queryKey: SESSION_EXCLUDE_LIST_IDS_KEY,
    queryFn: () =>
      queryClient.getQueryData<string[]>(SESSION_EXCLUDE_LIST_IDS_KEY),
    initialData: () =>
      queryClient.getQueryData<string[]>(SESSION_EXCLUDE_LIST_IDS_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelections = useCallback(
    (next: string[]) => {
      queryClient.setQueryData(SESSION_EXCLUDE_LIST_IDS_KEY, next);
    },
    [queryClient]
  );

  return { selections: data, setSelections };
}
