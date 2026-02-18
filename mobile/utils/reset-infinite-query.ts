/**
 * Utility helper for mobile feature logic: Reset infinite query.
 */
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

export async function resetInfiniteQuery<T>(queryClient: QueryClient, queryKey: QueryKey) {
  // This is useful for pull-to-refresh flows on infinite lists.
  // Keep only the first page so pull-to-refresh starts from a clean pagination baseline.
  queryClient.setQueryData<InfiniteData<T>>(queryKey, (data) => {
    if (!data || data.pages.length === 0) return data;

    return {
      pages: [data.pages[0]],
      pageParams: [data.pageParams[0] ?? 0],
    };
  });

  // Trigger a refetch after trimming cached pages.
  await queryClient.invalidateQueries({ queryKey });
}
