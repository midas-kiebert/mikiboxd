import { useQuery, useQueryClient } from "@tanstack/react-query";

const KEY = ["session", "group_by_movie"] as const;

export function useSessionGroupByMovie() {
  const queryClient = useQueryClient();

  const { data: selection = false } = useQuery<boolean>({
    queryKey: KEY,
    queryFn: () => queryClient.getQueryData<boolean>(KEY) ?? false,
    initialData: () => queryClient.getQueryData<boolean>(KEY) ?? false,
    staleTime: Infinity,
  });

  const setSelection = (value: boolean) => {
    queryClient.setQueryData(KEY, value);
  };

  return { selection, setSelection };
}
