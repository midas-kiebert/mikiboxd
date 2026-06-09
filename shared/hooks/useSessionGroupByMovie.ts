import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SESSION_GROUP_BY_MOVIE_KEY = ["session", "group_by_movie"] as const;

export function useSessionGroupByMovie() {
  const queryClient = useQueryClient();

  // Mirror the other session-filter hooks: leave the cache entry `undefined`
  // until something is explicitly set, so callers (e.g. the favorite-preset
  // restore in useSharedTabFilters) can distinguish "never set" from "set to
  // false". Seeding `false` here would make group-by indistinguishable from an
  // explicit "Showtimes" choice and break that restore.
  const { data } = useQuery<boolean | undefined>({
    queryKey: SESSION_GROUP_BY_MOVIE_KEY,
    queryFn: () => queryClient.getQueryData<boolean>(SESSION_GROUP_BY_MOVIE_KEY),
    initialData: () => queryClient.getQueryData<boolean>(SESSION_GROUP_BY_MOVIE_KEY),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  });

  const setSelection = useCallback(
    (value: boolean) => {
      queryClient.setQueryData(SESSION_GROUP_BY_MOVIE_KEY, value);
    },
    [queryClient]
  );

  return { selection: Boolean(data), setSelection };
}
