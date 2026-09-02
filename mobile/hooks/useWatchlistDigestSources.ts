import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  MeService,
  type WatchlistDigestSourceCreate,
  type WatchlistDigestSourcePublic,
  type WatchlistDigestSourceUpdate,
} from 'shared';

export const WATCHLIST_DIGEST_SOURCES_KEY = ['me', 'watchlist-digest-sources'] as const;

export function useWatchlistDigestSources(
  enabled = true
): UseQueryResult<WatchlistDigestSourcePublic[], Error> {
  return useQuery<WatchlistDigestSourcePublic[], Error>({
    queryKey: WATCHLIST_DIGEST_SOURCES_KEY,
    queryFn: () => MeService.getWatchlistDigestSources(),
    enabled,
  });
}

/** Mutations for managing a user's watchlist digest sources (see `nextfix.md`
 * item on multi-source digest notifications). Each refreshes the cached
 * source list so the settings screen reflects the change immediately. */
export function useWatchlistDigestSourceMutations() {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: WATCHLIST_DIGEST_SOURCES_KEY });
  }, [queryClient]);

  const createSource = useMutation<
    WatchlistDigestSourcePublic,
    Error,
    WatchlistDigestSourceCreate
  >({
    mutationFn: (payload) => MeService.createWatchlistDigestSource({ requestBody: payload }),
    onSuccess: invalidate,
  });

  const updateSource = useMutation<
    WatchlistDigestSourcePublic,
    Error,
    { sourceId: string; payload: WatchlistDigestSourceUpdate }
  >({
    mutationFn: ({ sourceId, payload }) =>
      MeService.updateWatchlistDigestSource({ sourceId, requestBody: payload }),
    onSuccess: invalidate,
  });

  const deleteSource = useMutation<unknown, Error, string>({
    mutationFn: (sourceId) => MeService.deleteWatchlistDigestSource({ sourceId }),
    onSuccess: invalidate,
  });

  return { createSource, updateSource, deleteSource };
}
