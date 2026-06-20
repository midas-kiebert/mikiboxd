import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  MeService,
  type LetterboxdListPublic,
  type MeGetLetterboxdListsResponse,
} from "../client";

const LETTERBOXD_LISTS_KEY = ["me", "letterboxd-lists"] as const;

export function useFetchLetterboxdLists(
  enabled = true
): UseQueryResult<MeGetLetterboxdListsResponse, Error> {
  return useQuery<MeGetLetterboxdListsResponse, Error>({
    queryKey: LETTERBOXD_LISTS_KEY,
    queryFn: () => MeService.getLetterboxdLists(),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Mutations for managing the user's Letterboxd lists. Each mutation refreshes
 * the cached list collection so the filter UI reflects the change immediately.
 */
export function useLetterboxdListMutations() {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: LETTERBOXD_LISTS_KEY });
  }, [queryClient]);

  const addList = useMutation<LetterboxdListPublic, Error, string>({
    mutationFn: (url: string) =>
      MeService.addLetterboxdList({ requestBody: { url } }),
    onSuccess: invalidate,
  });

  const syncList = useMutation<LetterboxdListPublic, Error, string>({
    mutationFn: (listId: string) =>
      MeService.syncLetterboxdList({ listId }),
    onSuccess: invalidate,
  });

  const removeList = useMutation<unknown, Error, string>({
    mutationFn: (listId: string) =>
      MeService.removeLetterboxdList({ listId }),
    onSuccess: invalidate,
  });

  return { addList, syncList, removeList };
}
