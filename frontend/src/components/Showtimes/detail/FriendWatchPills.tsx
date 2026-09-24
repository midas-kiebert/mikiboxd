/**
 * Which friends have the film on their Letterboxd watchlist, and which have
 * already seen it: two small pills in the header's text column, each opening a
 * popup with the names.
 *
 * They were full-width rows in the audience box ("Watchlisted by 3 friends")
 * and cost a line each there. Up here they sit in the room the poster already
 * reserves beside the text, so they add no height to the panel, and the list
 * behind them floats over it rather than pushing everything below it down.
 *
 * Watched wins over watchlisted: having seen it is the later fact, and a friend
 * counted in both reads as two different people at a glance. The watchlisted
 * popup carries a per-friend Invite, as the app's does; the watched one does
 * not, since those friends have already seen the film.
 *
 * Portalled, like every popup over the feed: the panel sits beside cards in
 * `content-visibility: auto` cells, which clip anything not lifted out.
 */
import { Box, Flex, Popover, Portal, Text } from "@chakra-ui/react"
import type { ShowtimePublic, UserPublic } from "shared"
import {
  type FriendWatchKind,
  getFriendWatchKindCopy,
} from "shared/friends/friend-watch-kind"

import { useIsSignedIn } from "@/auth/useSession"
import { PanelPressable } from "@/components/Showtimes/detail/PanelChrome"
import {
  PersonChip,
  personName,
} from "@/components/Showtimes/detail/PersonAvatar"
import {
  PanelIcon,
  WATCH_KIND_ICON,
} from "@/components/Showtimes/detail/panel-icons"
import { useShowtimeInvites } from "@/features/showtimes/useShowtimeInvites"

/** How tall the list may get before it scrolls inside the popup. */
const LIST_MAX_HEIGHT = "260px"

const FOCUS_RING = {
  outline: "2px solid",
  outlineColor: "app.tint",
  outlineOffset: "1px",
} as const

type InviteControls = {
  isInvited: (friendId: string) => boolean
  onInvite: (friend: UserPublic) => void
  disabled: boolean
}

const InviteButton = ({
  friend,
  invite,
}: {
  friend: UserPublic
  invite: InviteControls
}) =>
  invite.isInvited(friend.id) ? (
    <Text fontSize="11px" fontWeight="600" color="fg.subtle" flexShrink={0}>
      Invited
    </Text>
  ) : (
    <PanelPressable
      type="button"
      onClick={() => invite.onInvite(friend)}
      disabled={invite.disabled}
      aria-label={`Invite ${personName(friend)}`}
      display="flex"
      alignItems="center"
      gap="4px"
      flexShrink={0}
      px="8px"
      py="3px"
      borderRadius="full"
      borderWidth="1px"
      borderColor="app.blue.border"
      bg="app.blue.primary"
      color="app.blue.secondary"
      fontSize="11px"
      fontWeight="700"
      lineHeight="1.3"
      cursor={invite.disabled ? "not-allowed" : "pointer"}
      opacity={invite.disabled ? 0.5 : 1}
      _focusVisible={FOCUS_RING}
    >
      <Box as={PanelIcon.mailOutline} boxSize="13px" aria-hidden />
      <Box as="span" position="relative" top="1px">
        Invite
      </Box>
    </PanelPressable>
  )

const WatchPill = ({
  kind,
  friends,
  invite,
}: {
  kind: FriendWatchKind
  friends: readonly UserPublic[]
  /** Absent on the watched list, which is not something you invite from. */
  invite?: InviteControls
}) => {
  const copy = getFriendWatchKindCopy(kind)
  const people = friends.length === 1 ? "1 friend" : `${friends.length} friends`
  const sentence =
    kind === "watchlisted" ? `Watchlisted by ${people}` : `Watched by ${people}`

  return (
    <Popover.Root
      lazyMount
      unmountOnExit
      positioning={{ placement: "bottom-start", gutter: 6, strategy: "fixed" }}
    >
      <Popover.Trigger asChild>
        <PanelPressable
          type="button"
          title={sentence}
          display="inline-flex"
          alignItems="center"
          gap="3px"
          minH="20px"
          px="7px"
          borderRadius="full"
          bg={`app.${copy.palette}.primary`}
          color={`app.${copy.palette}.secondary`}
          fontSize="11px"
          fontWeight="700"
          lineHeight="1.3"
          cursor="pointer"
          transition="filter 120ms ease"
          _hover={{ filter: "brightness(0.97)" }}
          _focusVisible={FOCUS_RING}
        >
          <Box as={WATCH_KIND_ICON[copy.icon]} boxSize="13px" aria-hidden />
          <Box as="span" position="relative" top="1px">
            {`${friends.length} ${kind}`}
          </Box>
        </PanelPressable>
      </Popover.Trigger>

      <Portal>
        <Popover.Positioner>
          <Popover.Content
            w="260px"
            maxW="calc(100vw - 16px)"
            p="6px"
            borderRadius="12px"
            borderWidth="1px"
            borderColor="border"
            bg="bg.panel"
            boxShadow="0 4px 14px rgb(0 0 0 / 0.12)"
          >
            <Flex
              align="center"
              gap="6px"
              px="4px"
              pt="2px"
              pb="6px"
              color={`app.${copy.palette}.secondary`}
            >
              <Box as={WATCH_KIND_ICON[copy.icon]} boxSize="15px" aria-hidden />
              <Text fontSize="12px" fontWeight="700" lineHeight="1.3">
                {sentence}
              </Text>
            </Flex>
            <Box
              maxH={LIST_MAX_HEIGHT}
              overflowY="auto"
              overscrollBehavior="contain"
              px="4px"
            >
              {friends.map((friend) => (
                <PersonChip
                  key={friend.id}
                  user={friend}
                  trailing={
                    invite ? (
                      <InviteButton friend={friend} invite={invite} />
                    ) : null
                  }
                />
              ))}
            </Box>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  )
}

type FriendWatchPillsProps = {
  showtime: ShowtimePublic
}

const FriendWatchPills = ({ showtime }: FriendWatchPillsProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const { pingByFriendId, sendInvites, isSending } = useShowtimeInvites(
    showtime.id,
  )

  const watchlisted = showtime.viewer?.friends_watchlisted ?? []
  const watched = showtime.viewer?.friends_watched ?? []
  const watchedIds = new Set(watched.map((friend) => friend.id))
  const stillWatchlisted = watchlisted.filter(
    (friend) => !watchedIds.has(friend.id),
  )

  if (!isSignedIn || (stillWatchlisted.length === 0 && watched.length === 0))
    return null

  // Render/output using the state and derived values prepared above.
  return (
    <Flex wrap="wrap" gap="4px" mt="4px">
      {stillWatchlisted.length > 0 ? (
        <WatchPill
          kind="watchlisted"
          friends={stillWatchlisted}
          invite={{
            isInvited: (friendId) => pingByFriendId.has(friendId),
            onInvite: (friend) =>
              sendInvites([{ friendId: friend.id, name: personName(friend) }]),
            disabled: isSending,
          }}
        />
      ) : null}
      {watched.length > 0 ? (
        <WatchPill kind="watched" friends={watched} />
      ) : null}
    </Flex>
  )
}

export default FriendWatchPills
