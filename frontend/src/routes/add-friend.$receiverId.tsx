import { Button, Center, Flex, Spinner, Text, VStack } from "@chakra-ui/react"
import { Link as RouterLink, createFileRoute } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { type ApiError, FriendsService } from "shared"
import { storage } from "shared/storage"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const getErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiError)) return "Could not send friend request."

  const body = error.body
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as { detail?: unknown }).detail === "string"
  ) {
    return (body as { detail: string }).detail
  }

  return `Could not send friend request (${error.status}).`
}

export const Route = createFileRoute("/add-friend/$receiverId")({
  component: AddFriendLinkPage,
})

function AddFriendLinkPage() {
  const { receiverId } = Route.useParams()
  const normalizedReceiverId = useMemo(() => receiverId?.trim() || "", [receiverId])

  const [hasCheckedAuth, setHasCheckedAuth] = useState(false)
  const [hasAuth, setHasAuth] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    "Checking this friend invite link.",
  )

  const hasAttemptedRef = useRef(false)

  const requestMutation = useMutation({
    mutationFn: (targetUserId: string) =>
      FriendsService.sendFriendRequest({ receiverId: targetUserId }),
    onSuccess: () => {
      setHasStarted(false)
      setStatusMessage("Your friend request has been sent.")
    },
    onError: (error: unknown) => {
      setHasStarted(false)
      setStatusMessage(getErrorMessage(error))
    },
  })

  useEffect(() => {
    if (hasCheckedAuth) return

    storage
      .getItem("access_token")
      .then((token) => {
        setHasAuth(Boolean(token))
      })
      .catch(() => {
        setHasAuth(false)
      })
      .finally(() => {
        setHasCheckedAuth(true)
      })
  }, [hasCheckedAuth])

  useEffect(() => {
    if (!hasCheckedAuth || hasAttemptedRef.current) return
    hasAttemptedRef.current = true

    if (!UUID_PATTERN.test(normalizedReceiverId)) {
      setStatusMessage("Invalid friend invite link.")
      return
    }

    if (!hasAuth) {
      setStatusMessage("You need to log in before this invite link works.")
      return
    }

    setHasStarted(true)
    requestMutation.mutate(normalizedReceiverId)
  }, [hasCheckedAuth, hasAuth, normalizedReceiverId, requestMutation])

  const isSuccess = requestMutation.isSuccess
  const isError =
    requestMutation.isError &&
    statusMessage !== "Checking this friend invite link." &&
    statusMessage !== "Your friend request has been sent."

  return (
    <Center minH="100vh" px={4}>
      <Flex direction="column" align="center" gap={4} maxW="md" textAlign="center">
        <Text fontSize="2xl" fontWeight="bold">
          Add Friend
        </Text>

        {hasStarted || requestMutation.isPending ? (
          <VStack gap={2}>
            <Spinner size="lg" />
            <Text>Sending friend request...</Text>
          </VStack>
        ) : null}

        <Text>{statusMessage}</Text>

        <VStack gap={2}>
          {isSuccess && (
            <RouterLink to="/friends">
              <Button colorScheme="teal">Open Friends</Button>
            </RouterLink>
          )}

          {isError && (
            <RouterLink to="/friends">
              <Button colorScheme="teal" variant="outline">
                Go to Friends
              </Button>
            </RouterLink>
          )}

          {!hasAuth && hasCheckedAuth && (
            <RouterLink to="/login">
              <Button colorScheme="teal" variant="solid">
                Log in
              </Button>
            </RouterLink>
          )}
        </VStack>
      </Flex>
    </Center>
  )
}
