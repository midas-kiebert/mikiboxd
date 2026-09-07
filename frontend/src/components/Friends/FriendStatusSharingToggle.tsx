/**
 * Whether one friend can see your going/interested status.
 *
 * A per-friend opt-out that sits alongside the per-showtime visibility mode:
 * the mode decides which *group* can see a selection, this decides whether one
 * person is in that group at all. Someone you want as a friend but not as an
 * audience is a real case, and the website had no way to express it.
 *
 * `shares_status` is optional on the payload, so it is read as "on unless
 * explicitly false" — an older response without the field must not read as
 * having opted out.
 */
import { Button } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FriendsService } from "shared/client"

import useCustomToast from "@/hooks/useCustomToast"

type FriendStatusSharingToggleProps = {
  friendId: string
  friendName: string
  sharesStatus: boolean
}

const FriendStatusSharingToggle = ({
  friendId,
  friendName,
  sharesStatus,
}: FriendStatusSharingToggleProps) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()

  const { mutate: setSharing, isPending } = useMutation({
    mutationFn: (next: boolean) =>
      FriendsService.setFriendStatusSharing({
        friendId,
        requestBody: { shares_status: next },
      }),
    onSuccess: (_data, next) => {
      showSuccessToast(
        next
          ? `${friendName} can see your plans again.`
          : `${friendName} can no longer see your plans.`,
      )
      queryClient.invalidateQueries({ queryKey: ["users"] })
      // Who appears on a showtime depends on this.
      queryClient.invalidateQueries({ queryKey: ["showtimes"] })
    },
  })

  return (
    <Button
      size="2xs"
      variant={sharesStatus ? "surface" : "solid"}
      colorPalette={sharesStatus ? "gray" : "orange"}
      loading={isPending}
      onClick={() => setSharing(!sharesStatus)}
      title={
        sharesStatus
          ? `Hide your plans from ${friendName}`
          : `Show your plans to ${friendName} again`
      }
    >
      {sharesStatus ? "Sharing" : "Hidden"}
    </Button>
  )
}

export default FriendStatusSharingToggle
