/**
 * User settings feature component: Notifications.
 *
 * The website offered one checkbox — friend activity — against the seven
 * preferences the app exposes, so six of them could only be changed on a phone.
 * All seven are here now, each with the same three-way Off / Push / Email
 * choice, over the shared model in `shared/notifications/preferences`.
 *
 * "Push" is honest but worth a word: it is an account setting, and the delivery
 * it controls is to the app on the visitor's phone. The website cannot receive
 * a push notification, so the page says so rather than letting someone set a
 * channel that appears to do nothing.
 */
import { Container, Flex, Heading, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type ApiError, MeService } from "shared"
import useAuth from "shared/hooks/useAuth"
import {
  NOTIFICATION_LABELS,
  type NotificationDelivery,
  type NotificationPreferenceKey,
  TOGGLE_ORDER,
  buildDeliveryUpdate,
  getDelivery,
} from "shared/notifications/preferences"

import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const DELIVERY_OPTIONS: { value: NotificationDelivery; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "push", label: "Push" },
  { value: "email", label: "Email" },
]

const Notifications = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const { showSuccessToast } = useCustomToast()

  const { mutate: setDelivery, isPending } = useMutation({
    mutationFn: (variables: {
      key: NotificationPreferenceKey
      delivery: NotificationDelivery
    }) =>
      MeService.updateUserMe({
        // Built by the shared helper because a row can drive more than one
        // backend field, and every one of them has to move together.
        requestBody: buildDeliveryUpdate(variables.key, variables.delivery),
      }),
    onSuccess: () => {
      showSuccessToast("Notification preferences updated.")
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    },
    onError: (err: ApiError) => handleError(err),
  })

  // Render/output using the state and derived values prepared above.
  return (
    <Container maxW="full">
      <Heading size="sm" py={4}>
        Notifications
      </Heading>

      <Text color="fg.muted" mb={4} maxW="prose">
        Push notifications arrive in the MiKiNO app on your phone. Email arrives
        wherever you read your mail.
      </Text>

      <Stack gap={3} maxW="lg">
        {TOGGLE_ORDER.map((key) => {
          const current = getDelivery(currentUser, key)
          return (
            <Flex
              key={key}
              align="center"
              justify="space-between"
              gap={4}
              wrap="wrap"
            >
              <Text fontSize="sm">{NOTIFICATION_LABELS[key]}</Text>
              <Flex gap={1}>
                {DELIVERY_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    size="xs"
                    disabled={isPending}
                    variant={current === option.value ? "solid" : "surface"}
                    colorPalette={
                      current === option.value && option.value !== "off"
                        ? "green"
                        : "gray"
                    }
                    onClick={() => setDelivery({ key, delivery: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </Flex>
            </Flex>
          )
        })}
      </Stack>
    </Container>
  )
}

export default Notifications
