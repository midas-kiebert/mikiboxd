/**
 * Activity: everything that has happened to you, in one list.
 *
 * The website had `/pings` — showtime invites only — against the app's Activity
 * tab, which merges invites, friend requests, friend activity and the seat
 * alerts nobody caused. This is that feed.
 *
 * The wording of each row comes from `shared/notifications/feed-copy`, the same
 * function the app's row uses, so the two clients cannot describe the same
 * event differently.
 */
import { useEffect } from "react"
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import { FiX } from "react-icons/fi"
import type { NotificationFeedItem } from "shared"
import { FriendsService, MeService } from "shared/client"
import { useFetchNotifications } from "shared/hooks/useFetchNotifications"
import { getNotificationCopy } from "shared/notifications/feed-copy"

import { useIsSignedIn } from "@/auth/useSession"

/** The rows that are a request rather than a report, so they carry buttons. */
const isFriendRequest = (item: NotificationFeedItem) =>
  item.source === "friend_request" && item.type === "friend_request_received"

const NotificationsPage = () => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { data: items, isLoading } = useFetchNotifications({
    enabled: isSignedIn,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["me", "notifications"] })
    queryClient.invalidateQueries({ queryKey: ["users"] })
  }

  // Opening the page is what marks it read, which is what the app does too.
  const { mutate: markSeen } = useMutation({
    mutationFn: () => MeService.markMyNotificationsSeen(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["me", "notifications", "unseenCount"],
      }),
  })

  useEffect(() => {
    if (isSignedIn) markSeen()
  }, [isSignedIn, markSeen])

  /**
   * Two sources, two endpoints. `NotificationFeedItem.id` is a string because
   * the feed merges three tables; both dismiss endpoints take the row's own
   * numeric id, so it is parsed back here.
   */
  const { mutate: dismiss } = useMutation({
    mutationFn: (item: NotificationFeedItem) => {
      const id = Number(item.id)
      return item.source === "ping"
        ? MeService.dismissMyShowtimePing({ pingId: id })
        : MeService.dismissMyNotification({ notificationId: id })
    },
    onSuccess: refresh,
  })

  const { mutate: accept, isPending: isAccepting } = useMutation({
    mutationFn: (senderId: string) =>
      FriendsService.acceptFriendRequest({ senderId }),
    onSuccess: refresh,
  })

  const { mutate: decline, isPending: isDeclining } = useMutation({
    mutationFn: (senderId: string) =>
      FriendsService.declineFriendRequest({ senderId }),
    onSuccess: refresh,
  })

  if (isLoading) {
    return (
      <Center py={20}>
        <Spinner size="xl" />
      </Center>
    )
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Box maxW="720px" mx="auto" py={6} px={{ base: 3, md: 0 }}>
      <Heading size="md" mb={4}>
        Activity
      </Heading>

      {items?.length ? (
        <Stack gap={0}>
          {items.map((item) => {
            const copy = getNotificationCopy(item)
            const movieId = item.showtime?.movie.id

            return (
              <Flex
                key={`${item.source}:${item.id}`}
                align="flex-start"
                gap={3}
                py={3}
                borderBottomWidth="1px"
                borderColor="border"
                bg={item.seen_at ? undefined : "bg.subtle"}
              >
                <Box flex="1" minW={0}>
                  <Flex align="center" gap={2}>
                    <Text fontSize="sm" fontWeight="medium">
                      {copy.title}
                    </Text>
                    {item.seen_at ? null : (
                      <Badge size="sm" colorPalette="green">
                        New
                      </Badge>
                    )}
                  </Flex>
                  {copy.subtitle ? (
                    <Text fontSize="xs" color="fg.muted">
                      {copy.subtitle}
                    </Text>
                  ) : null}

                  {isFriendRequest(item) && item.actor ? (
                    <Flex gap={2} mt={2}>
                      <Button
                        size="xs"
                        colorPalette="green"
                        loading={isAccepting}
                        onClick={() => accept(item.actor?.id ?? "")}
                      >
                        Accept
                      </Button>
                      <Button
                        size="xs"
                        variant="surface"
                        loading={isDeclining}
                        onClick={() => decline(item.actor?.id ?? "")}
                      >
                        Decline
                      </Button>
                    </Flex>
                  ) : null}

                  {movieId ? (
                    <Button asChild size="xs" variant="ghost" mt={1} ps={0}>
                      <RouterLink
                        to="/movie/$movieId"
                        params={{ movieId: `${movieId}` }}
                      >
                        View showtime
                      </RouterLink>
                    </Button>
                  ) : null}
                </Box>

                {/* A friend request is resolved by answering it, so it has no
                    dismiss; notifications and invites can both be cleared. */}
                {item.source === "friend_request" ? null : (
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label="Dismiss"
                    onClick={() => dismiss(item)}
                  >
                    <FiX />
                  </IconButton>
                )}
              </Flex>
            )
          })}
        </Stack>
      ) : (
        <Text color="fg.muted">
          Nothing yet. Invites, friend requests and what your friends are seeing
          all land here.
        </Text>
      )}
    </Box>
  )
}

export default NotificationsPage
