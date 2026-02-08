import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

export async function resetInfiniteQuery<T>(queryClient: QueryClient, queryKey: QueryKey) {
  queryClient.setQueryData<InfiniteData<T>>(queryKey, (data) => {
    if (!data || data.pages.length === 0) return data;

    return {
      pages: [data.pages[0]],
      pageParams: [data.pageParams[0] ?? 0],
    };
  });

  await queryClient.invalidateQueries({ queryKey });
}
