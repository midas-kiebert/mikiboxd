/**
 * The cinema presets as the filter rail and its cinema sheet need them: your
 * preferred cinemas, your named presets in your order, and the writes behind
 * every preset button — the same endpoints, and the same words, as the app's
 * cinema sheet (`mobile/components/filters/CinemaFilterModal.tsx`).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"
import { type CinemaPresetPublic, MeService } from "shared/client"
import { serializeCinemaIds } from "shared/filters/cinema-grouping"
import {
  loadCinemaPresetOrder,
  saveCinemaPresetOrder,
  sortCinemaPresetsByOrder,
} from "shared/filters/cinema-preset-order"
import {
  findMyCinemasPreset,
  findNamedCinemaPresets,
  invalidateCinemaPresets,
  nextCinemaPresetName,
  planPromotePreset,
  planSaveAsPreferred,
  promotePresetOverReserved,
  saveSelectionAsPreferred,
  suggestRenameForReservedPreset,
  useCinemaPresets,
} from "shared/filters/cinema-presets"
import { selectedCinemasQueryKey } from "shared/hooks/useFetchSelectedCinemas"

import { setGuestPreferredCinemas } from "./guest-preferred-cinemas"

export type CinemaPresetState = ReturnType<typeof useCinemaPresetState>

export const useCinemaPresetState = ({
  isSignedIn,
  preferredCinemaIds,
}: {
  isSignedIn: boolean
  /** Your preferred cinemas, resolved — see `usePreferredCinemaIds`. */
  preferredCinemaIds: number[] | undefined
}) => {
  const queryClient = useQueryClient()
  const { data: presets = [] } = useCinemaPresets({ enabled: isSignedIn })
  const [orderIds, setOrderIds] = useState<string[]>([])

  // The app keeps its preset order on the device, not the account; on the web
  // `shared/storage` is `localStorage`, so this reads the same key.
  useEffect(() => {
    void loadCinemaPresetOrder().then(setOrderIds)
  }, [])

  const preferred = findMyCinemasPreset(presets)
  const named = useMemo(
    () => sortCinemaPresetsByOrder(findNamedCinemaPresets(presets), orderIds),
    [presets, orderIds],
  )
  const preferredIds = preferred?.cinema_ids ?? preferredCinemaIds ?? null

  const refresh = useCallback(() => {
    invalidateCinemaPresets(queryClient)
    queryClient.invalidateQueries({ queryKey: selectedCinemasQueryKey })
  }, [queryClient])

  /**
   * The selection "Set as preferred cinemas" was last clicked for, so the button
   * reads "These are your preferred cinemas" on the click rather than after the
   * round trip. Keyed by the selection, so picking a cinema afterwards re-arms it.
   */
  const [justSavedPreferred, setJustSavedPreferred] = useState<string | null>(
    null,
  )

  const setPreferredMutation = useMutation({
    mutationFn: saveSelectionAsPreferred,
    onSuccess: refresh,
    onError: () => setJustSavedPreferred(null),
  })

  const makePresetPreferredMutation = useMutation({
    mutationFn: (presetId: string) =>
      MeService.setFavoriteCinemaPreset({ presetId }),
    onSuccess: refresh,
  })

  const promoteOverReservedMutation = useMutation({
    mutationFn: promotePresetOverReserved,
    onSuccess: refresh,
  })

  const createMutation = useMutation({
    mutationFn: (variables: {
      name: string
      cinemaIds: number[]
      overwrite: boolean
    }) =>
      MeService.createCinemaPreset({
        requestBody: {
          name: variables.name,
          cinema_ids: variables.cinemaIds,
          overwrite: variables.overwrite,
        },
      }),
    onSuccess: refresh,
  })

  /** One write for both halves of an edit: the name and the cinemas. */
  const updateMutation = useMutation({
    mutationFn: (variables: {
      presetId: string
      name: string
      cinemaIds: number[]
    }) =>
      MeService.renameCinemaPreset({
        presetId: variables.presetId,
        requestBody: { name: variables.name, cinema_ids: variables.cinemaIds },
      }),
    onSuccess: refresh,
  })

  const deleteMutation = useMutation({
    mutationFn: (presetId: string) =>
      MeService.deleteCinemaPreset({ presetId }),
    onSuccess: refresh,
  })

  const isPreferred = (cinemaIds: readonly number[]) =>
    justSavedPreferred === serializeCinemaIds(cinemaIds) ||
    (preferredIds !== null &&
      serializeCinemaIds(preferredIds) === serializeCinemaIds(cinemaIds))

  /** The named preset these cinemas *are*, matched on the cinemas, never the name. */
  const namedPresetFor = (
    cinemaIds: readonly number[],
  ): CinemaPresetPublic | null => {
    const signature = serializeCinemaIds(cinemaIds)
    return (
      named.find(
        (preset) => serializeCinemaIds(preset.cinema_ids) === signature,
      ) ?? null
    )
  }

  /**
   * Save a selection that is none of your presets under "My Cinemas" — see
   * `planSaveAsPreferred` for when that needs asking first. `renameReserved`
   * moves the old "My Cinemas" out of the way before the save.
   */
  const saveAsPreferred = (
    cinemaIds: number[],
    renameReserved?: { presetId: string; name: string },
  ) => {
    if (cinemaIds.length === 0) return Promise.resolve()
    setJustSavedPreferred(serializeCinemaIds(cinemaIds))
    // A guest has no presets to plan around; the set is kept in this browser.
    if (!isSignedIn) {
      setGuestPreferredCinemas(cinemaIds)
      return Promise.resolve()
    }
    return setPreferredMutation.mutateAsync({ cinemaIds, renameReserved })
  }

  const movePreset = (from: number, to: number) => {
    if (to < 0 || to >= named.length) return
    const next = named.map((preset) => preset.id)
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setOrderIds(next)
    void saveCinemaPresetOrder(next)
  }

  return {
    preferred,
    preferredIds,
    named,
    /** Your preferred cinemas count as a set, which is what the rail's "≥ 2" means. */
    savedSetCount: (preferred ? 1 : 0) + named.length,
    suggestedName: nextCinemaPresetName(presets),
    isPreferred,
    namedPresetFor,
    planPreferred: (cinemaIds: readonly number[]) =>
      planSaveAsPreferred(presets, cinemaIds),
    planPromote: (preset: CinemaPresetPublic) =>
      planPromotePreset(presets, preset),
    promoteOverReserved: promoteOverReservedMutation.mutateAsync,
    isPromotingOverReserved: promoteOverReservedMutation.isPending,
    suggestedRenameForReserved: suggestRenameForReservedPreset(presets),
    saveAsPreferred,
    isSavingPreferred: setPreferredMutation.isPending,
    makePresetPreferred: (presetId: string) =>
      makePresetPreferredMutation.mutate(presetId),
    createPreset: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updatePreset: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deletePreset: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    movePreset,
  }
}
