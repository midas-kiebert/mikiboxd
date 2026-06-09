/**
 * Shared data hook for saved presets (merged new + legacy), with the persisted
 * manual order applied. Used by both the preset chips and the manage modal so
 * order/favorite/delete stay in sync via the query cache.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FilterPresetScope } from "shared";

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

export function useDisplayPresets(scope: FilterPresetScope) {
  const queryClient = useQueryClient();

  const { data: rawPresets = [], isLoading } = useQuery({
    queryKey: displayPresetsQueryKey(scope),
    queryFn: () => fetchDisplayPresets(scope),
  });

  const { data: order = [] } = useQuery({
    queryKey: displayPresetOrderQueryKey(scope),
    queryFn: () => loadDisplayPresetOrder(scope),
    staleTime: Infinity,
  });

  const presets = useMemo(
    () => sortDisplayPresetsByOrder(rawPresets, order),
    [rawPresets, order]
  );

  const invalidatePresets = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey(scope) });
    queryClient.invalidateQueries({ queryKey: ["user", "favorite_filter_preset", scope] });
    queryClient.invalidateQueries({ queryKey: ["user", "favorite_saved_preset", scope] });
  }, [queryClient, scope]);

  const removeMutation = useMutation({
    mutationFn: (preset: DisplayPreset) => deleteDisplayPreset(preset),
    onSettled: invalidatePresets,
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ preset, makeFavorite }: { preset: DisplayPreset; makeFavorite: boolean }) =>
      setDisplayPresetFavorite(preset, scope, makeFavorite),
    // Optimistically reflect the new favorite (single per scope) for instant feedback.
    onMutate: ({ preset, makeFavorite }) => {
      const key = presetKey(preset);
      queryClient.setQueryData<DisplayPreset[]>(displayPresetsQueryKey(scope), (old) =>
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
      queryClient.setQueryData(displayPresetOrderQueryKey(scope), keys);
      saveDisplayPresetOrder(scope, keys).catch(() => undefined);
    },
    [queryClient, scope]
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
