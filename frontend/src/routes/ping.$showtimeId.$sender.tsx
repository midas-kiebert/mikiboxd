import { Button, Center, Flex, Spinner, Text, VStack } from "@chakra-ui/react"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { ApiError, ShowtimesService } from "shared"
import { storage } from "shared/storage"

const getErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiError)) return "Could not process the invite link."

  const body = error.body
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as { detail?: unknown }).detail === "string"
  ) {
    return (body as { detail: string }).detail
  }

  return `Could not process the invite link (${error.status}).`
}

export const Route = createFileRoute("/ping/$showtimeId/$sender" as never)({
  component: PingLinkPage,
})

function PingLinkPage() {
  const [pathShowtimeId, pathSender] = useMemo(() => {
    const match = window.location.pathname.match(/^\/ping\/([^/]+)\/([^/]+)$/)
    if (!match) return ["", ""]

    const rawShowtimeId = match[1] ?? ""
    const rawSender = match[2] ?? ""
    try {
      return [decodeURIComponent(rawShowtimeId), decodeURIComponent(rawSender)]
    } catch {
      return [rawShowtimeId, rawSender]
    }
  }, [])

  const { showtimeId, sender } = {
    showtimeId: pathShowtimeId,
    sender: pathSender,
  }

  const normalizedShowtimeId = useMemo(() => {
    const parsed = Number.parseInt(showtimeId?.trim() ?? "", 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }, [showtimeId])

  const normalizedSender = useMemo(() => sender?.trim() ?? "", [sender])

  const [hasCheckedAuth, setHasCheckedAuth] = useState(false)
  const [hasAuth, setHasAuth] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    "Checking this invite link.",
  )

  const hasAttemptedRef = useRef(false)

  const pingMutation = useMutation({
    mutationFn: (payload: { showtimeId: number; sender: string }) =>
      ShowtimesService.receivePingFromLink({
        showtimeId: payload.showtimeId,
        senderIdentifier: payload.sender,
      }),
    onSuccess: () => {
      setHasStarted(false)
      setStatusMessage("You can now open your invites.")
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

    if (normalizedShowtimeId === null || normalizedSender.length === 0) {
      setStatusMessage("Invalid invite link.")
      return
    }

    if (!hasAuth) {
      setStatusMessage("You need to log in before this invite link works.")
      return
    }

    setHasStarted(true)
    pingMutation.mutate({
      showtimeId: normalizedShowtimeId,
      sender: normalizedSender,
    })
  }, [
    hasCheckedAuth,
    hasAuth,
    normalizedShowtimeId,
    normalizedSender,
    pingMutation,
  ])

  const isSuccess = pingMutation.isSuccess

  return (
    <Center minH="100vh" px={4}>
      <Flex
        direction="column"
        align="center"
        gap={4}
        maxW="md"
        textAlign="center"
      >
        <Text fontSize="2xl" fontWeight="bold">
          Showtime Invite
        </Text>

        {hasStarted || pingMutation.isPending ? (
          <VStack gap={2}>
            <Spinner size="lg" />
            <Text>Opening invite...</Text>
          </VStack>
        ) : null}

        <Text>{statusMessage}</Text>

        <VStack gap={2}>
          {isSuccess && (
            <Button
              onClick={() => window.location.assign("/pings")}
              colorScheme="teal"
            >
              Open Invites
            </Button>
          )}

          {hasCheckedAuth && !hasAuth && (
            <Button
              onClick={() => window.location.assign("/login")}
              colorScheme="teal"
              variant="solid"
            >
              Log in
            </Button>
          )}
        </VStack>
      </Flex>
    </Center>
  )
}
