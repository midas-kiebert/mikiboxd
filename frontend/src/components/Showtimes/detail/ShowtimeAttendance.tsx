/**
 * The audience box: who else is at this screening, and who wants to be.
 *
 * Laid out as the app lays it out — one bordered box directly under the header,
 * holding a wrap of name pills, and a plain sentence when it is empty. It sits
 * *above* the status buttons on purpose, which is the app's order and the right
 * one: who is already going is usually what decides whether you are.
 *
 * The Letterboxd marks are where this deliberately differs from the app. There
 * they are an icon and a number in the header's top corner, and both the count's
 * meaning and the names behind it cost a tap. Here they are a named row —
 * "Watchlisted by 3 friends" — that opens in place into the same list the app's
 * popup shows, with the same per-friend Invite button on the watchlisted side.
 * A desktop column has the room for that, and it puts "who is here" and "who
 * would come if I asked" in one block, which is the same question one step
 * apart.
 *
 * Watched stays a plain list even when expanded, for the app's reason: those
 * friends have already seen the film, so inviting them to a screening of it is
 * not what that list is for.
 *
 * Everything here is already in the showtime payload the feed fetched
 * (`viewer.friends_going`, `friends_of_friends_*`, `friends_watchlisted`,
 * `friends_watched`), so opening the panel costs no request at all and the box
 * paints in the same frame as the header.
 *
 * Hidden entirely for a guest, who has no friends list for it to describe.
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import { useState } from "react"
import type { ShowtimePublic, UserPublic } from "shared"
import {
  type FriendWatchKind,
  getFriendWatchKindCopy,
} from "shared/friends/friend-watch-kind"

import { useIsSignedIn } from "@/auth/useSession"
import FriendBadges from "@/components/Showtimes/detail/FriendBadges"
import ShowtimeInvitePanel from "@/components/Showtimes/detail/ShowtimeInvitePanel"
import {
  PanelPressable,
  PANEL_ROW_VALUE_SIZE,
} from "@/components/Showtimes/detail/PanelChrome"
import {
  PanelIcon,
  WATCH_KIND_ICON,
} from "@/components/Showtimes/detail/panel-icons"
import {
  PersonChip,
  personName,
} from "@/components/Showtimes/detail/PersonAvatar"
import { useShowtimeInvites } from "@/features/showtimes/useShowtimeInvites"

/** "Watchlisted by 3 friends" — the count's meaning spelled out, not an icon. */
const watchRowLabel = (kind: FriendWatchKind, count: number): string => {
  const people = count === 1 ? "1 friend" : `${count} friends`
  return kind === "watchlisted"
    ? `Watchlisted by ${people}`
    : `Watched by ${people}`
}

type WatchListProps = {
  kind: FriendWatchKind
  friends: readonly UserPublic[]
  /** Absent on the watched list, which is not something you invite from. */
  invite?: {
    isInvited: (friendId: string) => boolean
    onInvite: (friend: UserPublic) => void
    disabled: boolean
  }
}

const WatchList = ({ kind, friends, invite }: WatchListProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const copy = getFriendWatchKindCopy(kind)

  if (friends.length === 0) return null

  return (
    <Box>
      <PanelPressable
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        display="flex"
        alignItems="center"
        gap="8px"
        w="100%"
        py="2px"
        bg="transparent"
        cursor="pointer"
        textAlign="left"
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "app.tint",
          outlineOffset: "1px",
        }}
      >
        <Flex
          as="span"
          align="center"
          justify="center"
          flexShrink={0}
          boxSize="26px"
          borderRadius="full"
          bg={`app.${copy.palette}.primary`}
          color={`app.${copy.palette}.secondary`}
        >
          <Box as={WATCH_KIND_ICON[copy.icon]} boxSize="16px" aria-hidden />
        </Flex>

        <Text
          fontSize={PANEL_ROW_VALUE_SIZE}
          fontWeight="700"
          color={`app.${copy.palette}.secondary`}
          flex="1"
          minW={0}
          truncate
        >
          {watchRowLabel(kind, friends.length)}
        </Text>

        <Box
          as={PanelIcon.expandMore}
          boxSize="18px"
          flexShrink={0}
          color="fg.subtle"
          transition="transform 160ms ease"
          transform={isOpen ? "rotate(180deg)" : "rotate(0deg)"}
          aria-hidden
        />
      </PanelPressable>

      {isOpen ? (
        <Box pt="6px">
          {friends.map((friend) => {
            const invited = invite?.isInvited(friend.id) ?? false

            return (
              <PersonChip
                key={friend.id}
                user={friend}
                trailing={
                  invite ? (
                    invited ? (
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
                        _focusVisible={{
                          outline: "2px solid",
                          outlineColor: "app.tint",
                          outlineOffset: "1px",
                        }}
                      >
                        <Box as={PanelIcon.mailOutline} boxSize="13px" aria-hidden />
                        Invite
                      </PanelPressable>
                    )
                  ) : null
                }
              />
            )
          })}
        </Box>
      ) : null}
    </Box>
  )
}

type ShowtimeAttendanceProps = {
  showtime: ShowtimePublic
}

const ShowtimeAttendance = ({ showtime }: ShowtimeAttendanceProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const viewer = showtime.viewer
  const { pingByFriendId, sendInvites, isSending } = useShowtimeInvites(showtime.id)

  const going = viewer?.friends_going ?? []
  const interested = viewer?.friends_interested ?? []
  const beyondGoing = viewer?.friends_of_friends_going ?? []
  const beyondInterested = viewer?.friends_of_friends_interested ?? []

  const watchlisted = viewer?.friends_watchlisted ?? []
  const watched = viewer?.friends_watched ?? []

  // Watched wins over watchlisted: having seen it is the later fact, and a
  // friend counted in both rows reads as two different people at a glance.
  const watchedIds = new Set(watched.map((friend) => friend.id))
  const stillWatchlisted = watchlisted.filter((friend) => !watchedIds.has(friend.id))

  const hasAudience =
    going.length + interested.length + beyondGoing.length + beyondInterested.length > 0

  if (!isSignedIn) return null

  // Render/output using the state and derived values prepared above.
  return (
    <Box px={3} pt={4} pb={4}>
      <Box
        borderWidth="1px"
        borderColor="border"
        borderRadius="10px"
        bg="bg.subtle"
        overflow="hidden"
      >
        {/* The audience always has its own section, so "nobody yet" still
            reads as an answer when friends have the film on a list below. */}
        <Box px="12px" py="12px">
          {hasAudience ? (
            <FriendBadges
              friendsGoing={going}
              friendsInterested={interested}
              friendsOfFriendsGoing={beyondGoing}
              friendsOfFriendsInterested={beyondInterested}
            />
          ) : (
            <Text fontSize="13px" color="fg.subtle" lineHeight="1.4" textAlign="center">
              No friends are interested in this showtime yet.
            </Text>
          )}
        </Box>

        {stillWatchlisted.length > 0 ? (
          <Box px="12px" py="7px" borderTopWidth="1px" borderColor="border.muted">
            <WatchList
              kind="watchlisted"
              friends={stillWatchlisted}
              invite={{
                isInvited: (friendId) => pingByFriendId.has(friendId),
                onInvite: (friend) =>
                  sendInvites([{ friendId: friend.id, name: personName(friend) }]),
                disabled: isSending,
              }}
            />
          </Box>
        ) : null}

        {watched.length > 0 ? (
          <Box px="12px" py="7px" borderTopWidth="1px" borderColor="border.muted">
            <WatchList kind="watched" friends={watched} />
          </Box>
        ) : null}

        {/* Inviting closes the box rather than the panel: "who would come if I
            asked" and asking them are one step apart, and down at the foot of
            the panel the picker opened below the fold where nobody saw it. */}
        <ShowtimeInvitePanel showtime={showtime} />
      </Box>
    </Box>
  )
}

export default ShowtimeAttendance
