/**
 * Read and flip `use_letterboxd_avatar` — whether the Letterboxd profile
 * picture may be shown as the account's avatar. Off by default.
 *
 * Optimistic: the switch moves the instant it is pressed and the cached
 * current user is rolled back if the save fails. Used by Settings on both
 * clients, the app's intro and its feature tip, so all of them agree.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { MeService, type UserMe } from "../client"
import useAuth from "./useAuth"

const CURRENT_USER_KEY = ["currentUser"]

export default function useLetterboxdAvatarPreference() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      MeService.updateUserMe({ requestBody: { use_letterboxd_avatar: enabled } }),
    onMutate: async (enabled: boolean) => {
      await queryClient.cancelQueries({ queryKey: CURRENT_USER_KEY })
      const previous = queryClient.getQueryData<UserMe | null>(CURRENT_USER_KEY)
      if (previous) {
        queryClient.setQueryData<UserMe>(CURRENT_USER_KEY, {
          ...previous,
          use_letterboxd_avatar: enabled,
        })
      }
      return { previous }
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(CURRENT_USER_KEY, context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY })
    },
  })

  return {
    enabled: user?.use_letterboxd_avatar ?? false,
    // The picture itself, whether or not it is switched on, for a preview.
    // `null` until a watchlist sync has read one off Letterboxd.
    pictureUrl: user?.letterboxd_avatar_url ?? null,
    setEnabled: (enabled: boolean) => mutation.mutate(enabled),
    // Turning it on fetches the picture there and then; the saved account
    // that comes back says whether Letterboxd had one to give.
    enable: () => mutation.mutateAsync(true),
    isSaving: mutation.isPending,
    isError: mutation.isError,
  }
}
