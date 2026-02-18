/**
 * User settings feature component: Notifications.
 */
import { Button, Container, Heading, Text, VStack } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { type ApiError, MeService } from "shared"
import useAuth from "shared/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { Checkbox } from "../ui/checkbox"

const Notifications = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()
  // Data hooks keep this module synced with backend data and shared cache state.
  const { user: currentUser } = useAuth()
  const { showSuccessToast } = useCustomToast()
  const [friendMatchEnabled, setFriendMatchEnabled] = useState(false)

  useEffect(() => {
    setFriendMatchEnabled(!!currentUser?.notify_on_friend_showtime_match)
  }, [currentUser?.notify_on_friend_showtime_match])

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      MeService.updateUserMe({
        requestBody: {
          notify_on_friend_showtime_match: enabled,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Notification preferences updated.")
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    },
    onError: (err: ApiError) => {
      handleError(err)
    },
  })

  // Render/output using the state and derived values prepared above.
  return (
    <Container maxW="full">
      <Heading size="sm" py={4}>
        Notifications
      </Heading>
      <VStack align="start" gap={4} w={{ base: "100%", md: "sm" }}>
        <Text color="gray.500">
          Receive a push notification when a friend marks themselves as going or
          interested in a showtime you also selected.
        </Text>
        <Checkbox
          checked={friendMatchEnabled}
          onCheckedChange={(details) => setFriendMatchEnabled(!!details.checked)}
        >
          Friend showtime overlap notifications
        </Checkbox>
        <Button
          onClick={() => mutation.mutate(friendMatchEnabled)}
          loading={mutation.isPending}
          disabled={
            mutation.isPending ||
            friendMatchEnabled === !!currentUser?.notify_on_friend_showtime_match
          }
        >
          Save
        </Button>
      </VStack>
    </Container>
  )
}

export default Notifications
