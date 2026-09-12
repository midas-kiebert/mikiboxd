/**
 * Everything the panel can do with an invite to one screening, in one hook.
 *
 * Two sections need it now — the invite panel at the foot, and the "Watchlisted
 * by N friends" list in the audience box, which carries a per-friend Invite
 * button exactly as the app's watch popup does. They have to agree about who is
 * already invited or the same friend reads as invited in one and not the other,
 * so the sent-pings query, its key and every mutation that touches it live here
 * rather than in whichever component happened to need them first.
 *
 * Sending is optimistic. Inviting is a request to a person, and a button that
 * sits unchanged while it flies reads as not having worked; the provisional
 * ping is written into the cache on press and rolled back if the send fails.
 * Its `id` is negative so nothing mistakes it for a row the server minted.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import type { SentShowtimePingPublic } from "shared"
import { ShowtimesService } from "shared/client"
import useTrackEvent from "shared/hooks/useTrackEvent"

import { useIsSignedIn } from "@/auth/useSession"
import useCustomToast from "@/hooks/useCustomToast"

export const sentPingsQueryKey = (showtimeId: number) =>
  ["showtime", showtimeId, "sent-pings"] as const

type InviteTarget = { friendId: string; name: string }

export const useShowtimeInvites = (showtimeId: number) => {
  // Read flow: prepare derived values/handlers first, then return the API.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { trackEvent } = useTrackEvent()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  const { data: sentPings } = useQuery({
    queryKey: sentPingsQueryKey(showtimeId),
    queryFn: () => ShowtimesService.getSentPingsForShowtime({ showtimeId }),
    enabled: isSignedIn,
    staleTime: 30_000,
  })

  const refreshPings = () =>
    queryClient.invalidateQueries({ queryKey: sentPingsQueryKey(showtimeId) })

  const writePings = (
    update: (previous: SentShowtimePingPublic[]) => SentShowtimePingPublic[],
  ) =>
    queryClient.setQueryData<SentShowtimePingPublic[]>(
      sentPingsQueryKey(showtimeId),
      (previous) => update(previous ?? []),
    )

  const { mutate: sendInvites, isPending: isSending } = useMutation({
    mutationFn: async (targets: InviteTarget[]) => {
      // One request per friend is what the API offers, so the batching is
      // here: they go out together and the panel settles once, rather than
      // flickering per invite.
      const results = await Promise.allSettled(
        targets.map(({ friendId }) =>
          ShowtimesService.pingFriendForShowtime({ showtimeId, friendId }),
        ),
      )
      return results.filter((result) => result.status === "rejected").length
    },
    onMutate: (targets) => {
      const previous =
        queryClient.getQueryData<SentShowtimePingPublic[]>(
          sentPingsQueryKey(showtimeId),
        ) ?? []
      const known = new Set(previous.map((ping) => ping.receiver_id))
      writePings((current) => [
        ...current,
        ...targets
          .filter(({ friendId }) => !known.has(friendId))
          .map(({ friendId, name }, index): SentShowtimePingPublic => ({
            // Negative so it cannot collide with a server id, and so anything
            // keying off it can tell a provisional row from a real one.
            id: -(Date.now() + index),
            receiver_id: friendId,
            receiver_name: name,
            created_at: new Date().toISOString(),
            seen_at: null,
            dismissed_at: null,
          })),
      ])
      return { previous }
    },
    onSuccess: (failed, targets) => {
      trackEvent("invite_sent")
      if (failed > 0) {
        showErrorToast(
          failed === targets.length
            ? "Those invites didn't send."
            : `${failed} of those invites didn't send.`,
        )
      } else {
        showSuccessToast(
          targets.length === 1 ? "Invite sent." : `${targets.length} invites sent.`,
        )
      }
    },
    onError: (_error, _targets, context) => {
      if (context?.previous) writePings(() => context.previous)
      showErrorToast("Those invites didn't send.")
    },
    onSettled: refreshPings,
  })

  const { mutate: uninvite } = useMutation({
    mutationFn: (friendId: string) =>
      ShowtimesService.uninviteFriendFromShowtime({ showtimeId, friendId }),
    onMutate: (friendId) => {
      const previous =
        queryClient.getQueryData<SentShowtimePingPublic[]>(
          sentPingsQueryKey(showtimeId),
        ) ?? []
      writePings((current) =>
        current.filter((ping) => ping.receiver_id !== friendId),
      )
      return { previous }
    },
    onError: (_error, _friendId, context) => {
      if (context?.previous) writePings(() => context.previous)
      showErrorToast("Could not take that invite back.")
    },
    onSettled: refreshPings,
  })

  const { mutate: nudge } = useMutation({
    mutationFn: (friendId: string) =>
      ShowtimesService.sendShowtimeReminder({ showtimeId, friendId }),
    onSuccess: () => showSuccessToast("Nudged."),
    onError: () => showErrorToast("Could not send that nudge."),
  })

  /**
   * A link anyone can open, for the people who are not on here yet.
   *
   * The token is server-minted and signed rather than the sender's id, so the
   * receiving end can prove who sent it and the link cannot be forged by
   * swapping an id in the URL.
   */
  const { mutate: copyInviteLink, isPending: isBuildingLink } = useMutation({
    mutationFn: async () => {
      const { token } = await ShowtimesService.createShowtimePingLinkToken({
        showtimeId,
      })
      await navigator.clipboard.writeText(
        `${window.location.origin}/ping/${showtimeId}/${token}`,
      )
    },
    onSuccess: () => showSuccessToast("Invite link copied."),
    onError: () => showErrorToast("Could not build an invite link."),
  })

  const pingByFriendId = useMemo(
    () => new Map((sentPings ?? []).map((ping) => [ping.receiver_id, ping])),
    [sentPings],
  )

  return {
    sentPings,
    pingByFriendId,
    sendInvites,
    isSending,
    uninvite,
    nudge,
    copyInviteLink,
    isBuildingLink,
  }
}
