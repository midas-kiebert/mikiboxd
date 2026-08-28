/**
 * "A saved preset was just applied", announced to whoever shows the result.
 *
 * The active-filter chips animate the difference a preset made, which means
 * telling a preset apply apart from the user editing one filter by hand. The
 * chips cannot see where a prop change came from, so the press says so
 * directly. A counter rather than a boolean: two applies in a row are two
 * separate events, even if nothing about the second differs.
 *
 * It also carries which dimensions the preset wrote to. Comparing before with
 * after can only find the ones whose value moved, and a preset that sets a
 * filter to what it already was is the case the row most needs to show: a
 * partial preset that skips a dimension must be told apart from one that sets
 * it to the same thing.
 */
import { useSyncExternalStore } from "react";

import type { PresetDimension } from "@/components/filters/saved-presets";

export type PresetApply = {
  /** Increments on every apply, so two identical applies are two events. */
  count: number;
  /** Every dimension the apply wrote, changed or not. */
  dimensions: readonly PresetDimension[];
  /** Which preset it was, for the button that has to stay lit afterwards. */
  presetId: string | null;
};

const NONE: PresetApply = { count: 0, dimensions: [], presetId: null };

// Replaced, never mutated: `useSyncExternalStore` compares snapshots by
// identity and must see the same object until the next apply.
let latest: PresetApply = NONE;
const listeners = new Set<() => void>();

export function announcePresetApplied(
  dimensions: readonly PresetDimension[],
  presetId: string
) {
  latest = { count: latest.count + 1, dimensions, presetId };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => latest;

/** The last preset apply, in the same commit as the filters it set. */
export function usePresetApply(): PresetApply {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
