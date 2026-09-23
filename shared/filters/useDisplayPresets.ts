/**
 * Shared data hook for saved presets, with the persisted manual order
 * applied. Used by both the preset chips and the manage modal so
 * order/delete stay in sync via the query cache.
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
  sortDisplayPresetsByOrder,
  type DisplayPreset,
} from "./saved-presets";

export function useDisplayPresets({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();

  const { data: rawPresets = [], isLoading } = useQuery({
    queryKey: displayPresetsQueryKey,
    queryFn: () => fetchDisplayPresets(),
    enabled,
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
  }, [queryClient]);

  const removeMutation = useMutation({
    mutationFn: (preset: DisplayPreset) => deleteDisplayPreset(preset),
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
    move,
  };
}
