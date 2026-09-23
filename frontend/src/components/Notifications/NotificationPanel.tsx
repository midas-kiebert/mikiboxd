/**
 * The notification panel: everything that has happened to you, in one list,
 * floating under the bell in the top nav.
 *
 * It was a page (`/pings`), and a tab in the nav beside Showtimes and Friends.
 * But nobody goes *to* their notifications the way they go to a feed — they
 * glance at them from wherever they are, which is what the app's bell sheet is
 * for. So it is a panel over the current page, and the nav keeps its tabs for
 * places.
 *
 * Only mounted while open (the bell's popover unmounts it on close), so the
 * list is fetched and polled only while someone is looking at it.
 */
import { Box, Flex, Icon, Skeleton, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { MdNotificationsNone } from "react-icons/md"
import type { NotificationFeedItem } from "shared"
import { FriendsService, MeService } from "shared/client"
import { useFetchNotifications } from "shared/hooks/useFetchNotifications"

import { useIsSignedIn } from "@/auth/useSession"
import NotificationRow from "@/components/Notifications/NotificationRow"
import { closeNotificationPanel } from "@/components/Notifications/notification-panel"

const NOTIFICATIONS_KEY = ["me", "notifications"]

/** `id` alone is not unique: the feed merges three tables. */
const itemKey = (item: NotificationFeedItem) => `${item.source}:${item.id}`

const SectionLabel = ({ children }: { children: string }) => (
  <Text
    px={4.5}
    pt={3}
    pb={1.5}
    fontSize="11px"
    fontWeight="700"
    letterSpacing="0.06em"
    textTransform="uppercase"
    color="fg.subtle"
  >
    {children}
  </Text>
)

const LoadingRows = () => (
  <Box px={4.5} py={2}>
    {[0, 1, 2, 3].map((index) => (
      <Flex key={index} gap={3} py={2.5} align="flex-start">
        <Skeleton boxSize="40px" borderRadius="full" flexShrink={0} />
        <Box flex="1" pt="3px">
          <Skeleton h="12px" w={index % 2 ? "70%" : "85%"} borderRadius="sm" />
          <Skeleton h="10px" w="50%" mt={2} borderRadius="sm" />
        </Box>
      </Flex>
    ))}
  </Box>
)

const EmptyState = () => (
  <Flex
    direction="column"
    align="center"
    textAlign="center"
    px={8}
    py={12}
    gap={3}
  >
    <Flex
      boxSize="52px"
      align="center"
      justify="center"
      borderRadius="full"
      bg="app.green.primary"
      color="app.green.secondary"
    >
      <Icon as={MdNotificationsNone} boxSize="26px" />
    </Flex>
    <Box>
      <Text fontSize="14px" fontWeight="700" color="fg">
        You&apos;re all caught up
      </Text>
      <Text fontSize="12.5px" color="fg.muted" mt={1} lineHeight="1.45">
        Invites, friend requests and what your friends are seeing will land
        here.
      </Text>
    </Box>
  </Flex>
)

interface NotificationPanelProps {
  /** A notification opened its screening in the page's side panel. */
  onOpenedInPanel: () => void
}

const NotificationPanel = ({ onOpenedInPanel }: NotificationPanelProps) => {
  // Read flow: data hooks first, then handlers, then panel JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { data: items, isLoading } = useFetchNotifications({
    enabled: isSignedIn,
  })

  /**
   * What was unread when the panel opened stays marked "new" until it closes.
   * Opening marks everything seen, and the list polls, so reading `seen_at`
   * alone would clear the dots while you are still reading them.
   */
  const [newKeys, setNewKeys] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const unseen = items?.filter((item) => item.seen_at === null) ?? []
    if (unseen.every((item) => newKeys.has(itemKey(item)))) return
    setNewKeys((previous) => new Set([...previous, ...unseen.map(itemKey)]))
  }, [items, newKeys])

  /**
   * Opening the panel is what marks it read, as opening the app's sheet does.
   *
   * Both counters, because the feed merges both sources: marking only the
   * notification side left the invite badge lit after you had plainly read the
   * invite.
   */
  const { mutate: markSeen } = useMutation({
    mutationFn: () =>
      Promise.all([
        MeService.markMyNotificationsSeen(),
        MeService.markMyShowtimePingsSeen(),
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...NOTIFICATIONS_KEY, "unseenCount"],
      })
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] })
    },
  })

  useEffect(() => {
    if (isSignedIn) markSeen()
  }, [isSignedIn, markSeen])

  /**
   * Every action here takes its row out of the list at once, before the server
   * answers: a dismissed or answered notification is done with, and waiting
   * for the round trip made the list feel stuck. A failure refetches it back.
   */
  const removeRow = (item: NotificationFeedItem) => {
    queryClient.setQueriesData<NotificationFeedItem[]>(
      { queryKey: NOTIFICATIONS_KEY },
      (previous) =>
        Array.isArray(previous)
          ? previous.filter((other) => itemKey(other) !== itemKey(item))
          : previous,
    )
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
    queryClient.invalidateQueries({ queryKey: ["users"] })
  }

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
    onMutate: removeRow,
    onSettled: refresh,
  })

  const { mutate: accept } = useMutation({
    mutationFn: (item: NotificationFeedItem) =>
      FriendsService.acceptFriendRequest({ senderId: item.actor?.id ?? "" }),
    onMutate: removeRow,
    onSettled: refresh,
  })

  const { mutate: decline } = useMutation({
    mutationFn: (item: NotificationFeedItem) =>
      FriendsService.declineFriendRequest({ senderId: item.actor?.id ?? "" }),
    onMutate: removeRow,
    onSettled: refresh,
  })

  const fresh = items?.filter((item) => newKeys.has(itemKey(item))) ?? []
  const earlier = items?.filter((item) => !newKeys.has(itemKey(item))) ?? []

  const renderRows = (rows: NotificationFeedItem[]) =>
    rows.map((item) => (
      <NotificationRow
        key={itemKey(item)}
        item={item}
        isNew={newKeys.has(itemKey(item))}
        onNavigate={closeNotificationPanel}
        onOpenedInPanel={onOpenedInPanel}
        onDismiss={dismiss}
        onAccept={accept}
        onDecline={decline}
      />
    ))

  const body = isLoading ? (
    <LoadingRows />
  ) : !items?.length ? (
    <EmptyState />
  ) : fresh.length && earlier.length ? (
    <>
      <SectionLabel>New</SectionLabel>
      {renderRows(fresh)}
      <SectionLabel>Earlier</SectionLabel>
      {renderRows(earlier)}
    </>
  ) : (
    <Box pt={1.5}>{renderRows(items)}</Box>
  )

  // Render/output using the state and derived values prepared above.
  return (
    <Flex direction="column" flex="1" minH={0}>
      <Flex
        align="center"
        gap={2.5}
        px={4.5}
        h="54px"
        flexShrink={0}
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        <Text
          fontSize="15px"
          fontWeight="700"
          color="fg"
          letterSpacing="-0.01em"
        >
          Notifications
        </Text>
        {fresh.length ? (
          <Box
            px={2}
            borderRadius="full"
            bg="app.green.primary"
            color="app.green.secondary"
            fontSize="11px"
            fontWeight="700"
            lineHeight="20px"
          >
            {fresh.length} new
          </Box>
        ) : null}
      </Flex>

      <Box
        flex="1"
        minH={0}
        overflowY="auto"
        overscrollBehavior="contain"
        pb={1.5}
      >
        {body}
      </Box>
    </Flex>
  )
}

export default NotificationPanel
