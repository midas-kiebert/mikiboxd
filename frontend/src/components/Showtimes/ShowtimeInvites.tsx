import { Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
/**
 * Inviting friends to a showtime, from inside the detail panel.
 *
 * The app calls these "pings". This is the smaller half of what its showtime
 * sheet does — invite, uninvite, and nudge someone who has not answered — which
 * is the part that makes the feature usable at all. Per-showtime visibility and
 * the invite-link token are separate controls and belong to their own pass.
 *
 * Search is here because a friends list stops being scannable at about twenty
 * people, which is well below what anyone actually has.
 */
import { useState } from "react"
import { ShowtimesService } from "shared/client"
import { useFetchFriends } from "shared/hooks/useFetchFriends"
import useTrackEvent from "shared/hooks/useTrackEvent"

import { useIsSignedIn } from "@/auth/useSession"

type ShowtimeInvitesProps = {
  showtimeId: number
}

const sentPingsQueryKey = (showtimeId: number) =>
  ["showtime", showtimeId, "sent-pings"] as const

const ShowtimeInvites = ({ showtimeId }: ShowtimeInvitesProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { trackEvent } = useTrackEvent()
  const [search, setSearch] = useState("")
  const [linkCopied, setLinkCopied] = useState(false)

  const { data: friends } = useFetchFriends({ enabled: isSignedIn })

  /**
   * Friends who are going but whose own visibility hides them from you.
   *
   * Worth surfacing because they are the people most worth inviting — you would
   * otherwise be organising around a showtime they are already at. Only their
   * count is shown: naming them would be exactly the leak their setting exists
   * to prevent.
   */
  const { data: hiddenAttending } = useQuery({
    queryKey: ["showtimes", "hiddenAttendingFriends", showtimeId],
    queryFn: () =>
      ShowtimesService.getHiddenAttendingFriendsForShowtime({ showtimeId }),
    enabled: isSignedIn,
    staleTime: 30_000,
  })

  const { data: sentPings } = useQuery({
    queryKey: sentPingsQueryKey(showtimeId),
    queryFn: () => ShowtimesService.getSentPingsForShowtime({ showtimeId }),
    enabled: isSignedIn,
    staleTime: 30_000,
  })

  const refreshPings = () =>
    queryClient.invalidateQueries({ queryKey: sentPingsQueryKey(showtimeId) })

  const { mutate: invite, isPending: isInviting } = useMutation({
    mutationFn: (friendId: string) =>
      ShowtimesService.pingFriendForShowtime({ showtimeId, friendId }),
    onSuccess: () => {
      trackEvent("invite_sent")
      refreshPings()
    },
  })

  const { mutate: uninvite } = useMutation({
    mutationFn: (friendId: string) =>
      ShowtimesService.uninviteFriendFromShowtime({ showtimeId, friendId }),
    onSuccess: refreshPings,
  })

  const { mutate: remind } = useMutation({
    mutationFn: (friendId: string) =>
      ShowtimesService.sendShowtimeReminder({ showtimeId, friendId }),
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
      const url = `${window.location.origin}/ping/${showtimeId}/${token}`
      await navigator.clipboard.writeText(url)
      return url
    },
    onSuccess: () => setLinkCopied(true),
  })

  // A section that could only ever be empty is hidden rather than gated: a guest
  // has no friends list to invite from, so there is nothing here to discover.
  if (!isSignedIn) return null

  const invitedById = new Map(
    (sentPings ?? []).map((ping) => [ping.receiver_id, ping]),
  )

  const term = search.trim().toLowerCase()
  const visibleFriends = (friends ?? []).filter((friend) =>
    term ? (friend.display_name ?? "").toLowerCase().includes(term) : true,
  )

  // Render/output using the state and derived values prepared above.
  return (
    <Stack gap={2}>
      <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
        Invite friends
      </Text>

      {(friends?.length ?? 0) > 8 ? (
        <Input
          size="sm"
          placeholder="Search friends…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search friends"
        />
      ) : null}

      {friends?.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          Add friends to invite them to a showtime.
        </Text>
      ) : null}

      {hiddenAttending?.friends?.length ? (
        <Text fontSize="xs" color="fg.muted">
          {hiddenAttending.friends.length === 1
            ? "One friend here has their status hidden from you."
            : `${hiddenAttending.friends.length} friends here have their status hidden from you.`}{" "}
          Inviting them shows you to each other.
        </Text>
      ) : null}

      <Stack gap={1} maxH="260px" overflowY="auto">
        {visibleFriends.map((friend) => {
          const ping = invitedById.get(friend.id)
          const name = friend.display_name ?? "Friend"

          return (
            <Flex
              key={friend.id}
              align="center"
              gap={2}
              justify="space-between"
            >
              <Box minW={0}>
                <Text fontSize="sm" truncate>
                  {name}
                </Text>
                {ping ? (
                  <Text fontSize="xs" color="fg.muted">
                    {ping.seen_at ? "Seen" : "Invited"}
                  </Text>
                ) : null}
              </Box>

              <Flex gap={1} flexShrink={0}>
                {ping ? (
                  <>
                    {/* Nudging only makes sense for someone who has not answered. */}
                    {ping.seen_at ? null : (
                      <Button
                        size="2xs"
                        variant="surface"
                        onClick={() => remind(friend.id)}
                      >
                        Nudge
                      </Button>
                    )}
                    <Button
                      size="2xs"
                      variant="surface"
                      colorPalette="red"
                      onClick={() => uninvite(friend.id)}
                    >
                      Uninvite
                    </Button>
                  </>
                ) : (
                  <Button
                    size="2xs"
                    colorPalette="green"
                    loading={isInviting}
                    onClick={() => invite(friend.id)}
                  >
                    Invite
                  </Button>
                )}
              </Flex>
            </Flex>
          )
        })}
      </Stack>

      {/* For the people who are not on here yet. */}
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        loading={isBuildingLink}
        onClick={() => copyInviteLink()}
      >
        {linkCopied ? "Link copied" : "Copy an invite link"}
      </Button>
    </Stack>
  )
}

export default ShowtimeInvites
