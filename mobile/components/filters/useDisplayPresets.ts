/**
 * Shared data hook for saved presets, with the persisted manual order
 * applied. Used by both the preset chips and the manage modal so
 * order/favorite/delete stay in sync via the query cache.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteDisplayPreset,
  displayPresetOrderQueryKey,
  displayPresetsQueryKey,
  fetchDisplayPresets,
  loadDisplayPresetOrder,
  presetKey,
  saveDisplayPresetOrder,
  setDisplayPresetFavorite,
  sortDisplayPresetsByOrder,
  type DisplayPreset,
} from "@/components/filters/saved-presets";

export function useDisplayPresets() {
  const queryClient = useQueryClient();

  const { data: rawPresets = [], isLoading } = useQuery({
    queryKey: displayPresetsQueryKey,
    queryFn: () => fetchDisplayPresets(),
  });

  const { data: order = [] } = useQuery({
    queryKey: displayPresetOrderQueryKey,
    queryFn: () => loadDisplayPresetOrder(),
    staleTime: Infinity,
  });

  const presets = useMemo(
    () => sortDisplayPresetsByOrder(rawPresets, order),
    [rawPresets, order]
  );

  const invalidatePresets = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey });
    queryClient.invalidateQueries({ queryKey: ["user", "favorite_saved_preset"] });
  }, [queryClient]);

  const removeMutation = useMutation({
    mutationFn: (preset: DisplayPreset) => deleteDisplayPreset(preset),
    onSettled: invalidatePresets,
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ preset, makeFavorite }: { preset: DisplayPreset; makeFavorite: boolean }) =>
      setDisplayPresetFavorite(preset, makeFavorite),
    // Optimistically reflect the new favorite (single favorite overall) for instant feedback.
    onMutate: ({ preset, makeFavorite }) => {
      const key = presetKey(preset);
      queryClient.setQueryData<DisplayPreset[]>(displayPresetsQueryKey, (old) =>
        old?.map((p) => ({
          ...p,
          isFavorite: presetKey(p) === key ? makeFavorite : false,
        }))
      );
    },
    onSettled: invalidatePresets,
  });

  const reorder = useCallback(
    (orderedPresets: readonly DisplayPreset[]) => {
      const keys = orderedPresets.map(presetKey);
      queryClient.setQueryData(displayPresetOrderQueryKey, keys);
      saveDisplayPresetOrder(keys).catch(() => undefined);
    },
    [queryClient]
  );

  const move = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || toIndex >= presets.length) {
        return;
      }
      const next = [...presets];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return;
      next.splice(toIndex, 0, moved);
      reorder(next);
    },
    [presets, reorder]
  );

  return {
    presets,
    isLoading,
    remove: removeMutation.mutate,
    isRemoving: removeMutation.isPending,
    setFavorite: favoriteMutation.mutate,
    move,
  };
}
