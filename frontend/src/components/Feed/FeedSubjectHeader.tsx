/**
 * What sits above the home feed when it is narrowed to one friend or one
 * cinema: the page that used to be its own.
 *
 * A friend's agenda and a cinema's programme were separate routes, each a copy
 * of the home feed with one dimension pinned. They are filters now — "Only
 * these friends" and the cinema picker — so they can be combined with
 * everything else and left like any other filter. What the pages had that a
 * filter does not is *who* or *where*, and that is this header: exactly one
 * friend picked, or exactly one cinema resolved, and the feed looks as those
 * pages did. The old addresses redirect here.
 *
 *   - **A friend**: their picture and name, whether they can see your plans
 *     (the per-friend opt-out), remove, block and report — the same controls
 *     the app's friend screen has (`FriendAgendaOptions`). Someone who is not
 *     a friend gets their name and a way to become one, since their plans are
 *     not yours to see yet.
 *   - **A cinema**: its name in its own colour (a link to its website, as in
 *     the app), the city (a link to it on a map), and the website again as a
 *     plain link, since a coloured title does not read as one on the web.
 *
 * Both have a close button that takes the filter off, since the header is
 * where the page's subject is named and the obvious place to leave it.
 */
import { Box, Flex, IconButton, Link, Stack, Text } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { FiExternalLink, FiMapPin, FiX } from "react-icons/fi"
import {
  MdBlock,
  MdCheck,
  MdLockOutline,
  MdPeople,
  MdPersonAddAlt,
} from "react-icons/md"
import type { UserWithFriendStatus } from "shared"
import { getCinemaPaletteKey } from "shared/cinemas/cinema-color"
import { UsersService } from "shared/client"
import { resolveCinemaSelection } from "shared/filters/cinema-selection"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"
import { getAvatarPaletteKey } from "shared/users/avatar-color"

import { useIsSignedIn } from "@/auth/useSession"
import UserModerationMenu from "@/components/Friends/UserModerationMenu"
import {
  FriendButton,
  FriendVisibilityChoice,
  RemoveFriendDialog,
  useFriendActions,
} from "@/components/Friends/friend-controls"
import {
  PersonAvatar,
  personName,
} from "@/components/Showtimes/detail/PersonAvatar"
import { IconLabel } from "@/components/ui/icon-label"
import type { FeedParams } from "@/features/showtimes/feed-params"
import { usePreferredCinemaIds } from "@/features/showtimes/guest-preferred-cinemas"

type FeedSubject = {
  friendId: string | null
  cinema: CinemaLike | undefined
  /** Whether the cinema is one the visitor picked, so can be taken off. */
  isCinemaPicked: boolean
}

/**
 * Who or where the feed is about, or null when it is about neither.
 *
 * A hook of its own rather than a header that renders nothing, because the
 * page shell reserves a band for any `header` it is handed — an empty
 * component left a gap between the nav and the first row of the feed.
 */
export const useFeedSubject = (params: FeedParams): FeedSubject | null => {
  const isSignedIn = useIsSignedIn()
  const { data: cinemas } = useFetchCinemas()
  const { data: preferredCinemaIds } = usePreferredCinemaIds()

  // A guest has no friends to be looking at, and the lookup needs an account.
  const friendId =
    isSignedIn && params.friends.length === 1 ? params.friends[0] : null

  // The cinemas actually in force — picked, else the account's usual ones —
  // since "one cinema" is what the feed shows, however it came to be one.
  const cinemaIds = params.allCinemas
    ? []
    : resolveCinemaSelection({
        sessionCinemaIds: params.cinemas.length ? params.cinemas : undefined,
        preferredCinemaIds,
        allCinemaIds: cinemas?.map((cinema) => cinema.id) ?? [],
      })
  const cinema =
    cinemaIds.length === 1
      ? cinemas?.find((entry) => entry.id === cinemaIds[0])
      : undefined

  if (!friendId && !cinema) return null
  return { friendId, cinema, isCinemaPicked: params.cinemas.length > 0 }
}

/** The query `FriendHeader` reads, so both share one request and cache entry. */
export const useFriendStatus = (userId: string | null) =>
  useQuery<UserWithFriendStatus>({
    // The key `useFriendStatus` uses in the app, so a change made anywhere lands here.
    queryKey: ["users", "friendStatus", userId],
    queryFn: () =>
      UsersService.getUserFriendStatus({ userId: userId as string }),
    enabled: userId !== null,
  })

/**
 * What stands in for the empty feed when it is narrowed to one person who is
 * not a friend, or undefined to leave the page's own empty message. Their
 * plans never load, so the feed is always empty — rather than "nothing
 * matches these filters", say why, front and centre, with the one thing to do
 * about it: the web's `NonFriendProfile`.
 */
export const useNonFriendEmptyState = (
  subject: FeedSubject | null,
): ReactNode => {
  const friendId = subject?.friendId ?? null
  const { data: user } = useFriendStatus(friendId)
  if (!user || user.is_friend) return undefined
  return <NonFriendPanel user={user} />
}

type FeedSubjectHeaderProps = {
  subject: FeedSubject
  onChange: (patch: Partial<FeedParams>) => void
}

const FeedSubjectHeader = ({ subject, onChange }: FeedSubjectHeaderProps) => {
  const { friendId, cinema, isCinemaPicked } = subject
  return (
    <Stack gap={3}>
      {friendId ? (
        <FriendHeader
          userId={friendId}
          onClose={() => onChange({ friends: [] })}
        />
      ) : null}
      {cinema ? (
        <CinemaHeader
          cinema={cinema}
          // Only a cinema the visitor picked can be taken off; one that is
          // just the account's usual cinema is where "off" already lands.
          onClose={isCinemaPicked ? () => onChange({ cinemas: [] }) : undefined}
        />
      ) : null}
    </Stack>
  )
}

const HeaderCard = ({
  children,
  onClose,
  closeLabel,
}: {
  children: ReactNode
  onClose?: () => void
  closeLabel: string
}) => (
  <Flex
    align="center"
    gap={4}
    px={4}
    py={3}
    bg="bg.panel"
    borderWidth="1px"
    borderColor="border"
    borderRadius="md"
    boxShadow="sm"
  >
    {children}
    {onClose ? (
      <IconButton
        aria-label={closeLabel}
        title={closeLabel}
        size="sm"
        variant="ghost"
        color="fg.muted"
        alignSelf="flex-start"
        onClick={onClose}
      >
        <FiX />
      </IconButton>
    ) : null}
  </Flex>
)

// ---------------------------------------------------------------------------
// A friend.
// ---------------------------------------------------------------------------

const FriendHeader = ({
  userId,
  onClose,
}: { userId: string; onClose: () => void }) => {
  const { data: user } = useFriendStatus(userId)
  const name = user ? personName(user) : ""
  // The app tints the friend's name with their avatar colour (its top bar).
  const tone = `app.${getAvatarPaletteKey(userId)}`

  return (
    <HeaderCard
      onClose={onClose}
      closeLabel="Stop showing only this person's plans"
    >
      {user ? (
        <PersonAvatar user={user} size={44} />
      ) : (
        <Box boxSize="44px" flexShrink={0} />
      )}
      <Flex flex="1" minW={0} align="center" gap={4} wrap="wrap" rowGap={2}>
        <Stack gap="2px" flex="1" minW="160px">
          <Text
            fontSize="17px"
            fontWeight="700"
            lineHeight="1.25"
            color={`${tone}.secondary`}
            truncate
          >
            {name || "\u00a0"}
          </Text>
          {user ? <FriendSubline user={user} name={name} /> : null}
        </Stack>
        {user ? <FriendActions user={user} name={name} /> : null}
      </Flex>
    </HeaderCard>
  )
}

/**
 * The line under the name: the app's status line ("You're friends", "Friend
 * request sent", …), or its red badge when blocked. Block and report live in
 * the ⋮ menu beside the actions, out of the way.
 */
const FriendSubline = ({
  user,
  name,
}: { user: UserWithFriendStatus; name: string }) => {
  if (user.is_blocked) {
    return (
      <Flex
        align="center"
        gap="5px"
        alignSelf="flex-start"
        px="8px"
        py="2px"
        borderRadius="full"
        bg="app.red.primary"
        color="app.red.secondary"
        fontSize="12px"
        fontWeight="600"
      >
        <MdBlock size={13} />
        <IconLabel>You've blocked this account</IconLabel>
      </Flex>
    )
  }
  const subtitle = user.is_friend
    ? "You're friends"
    : user.received_request
      ? `${name} wants to be your friend`
      : user.sent_request
        ? "Friend request sent"
        : "You're not friends yet"
  return (
    <Flex
      align="center"
      gap="5px"
      color="app.textSecondary"
      fontSize="12px"
      fontWeight="600"
    >
      {user.is_friend ? <MdPeople size={13} /> : <MdLockOutline size={13} />}
      <IconLabel>{subtitle}</IconLabel>
    </Flex>
  )
}

/**
 * The right-hand side: for a friend, who can see your showtimes; for anyone
 * else just the menu, since their request buttons sit centred in the feed. Remove, block and report are all in the ⋮
 * menu — rare, and not worth the room.
 */
const FriendActions = ({
  user,
  name,
}: { user: UserWithFriendStatus; name: string }) => {
  const actions = useFriendActions(user.id, name)
  const [isRemoveOpen, setIsRemoveOpen] = useState(false)

  if (user.is_blocked) {
    return <UserModerationMenu userId={user.id} userName={name} isBlocked />
  }

  // The request buttons are in the centred panel (`NonFriendPanel`).
  if (!user.is_friend) {
    return <UserModerationMenu userId={user.id} userName={name} />
  }

  return (
    <Flex align="flex-end" gap={1} w={{ base: "100%", sm: "auto" }}>
      <FriendVisibilityChoice
        friendId={user.id}
        name={name}
        sharesStatus={user.shares_status !== false}
      />
      <RemoveFriendDialog
        name={name}
        open={isRemoveOpen}
        onClose={() => setIsRemoveOpen(false)}
        onConfirm={() => actions.remove.mutate()}
      />
      <Box alignSelf="flex-end" pb="2px">
        <UserModerationMenu
          userId={user.id}
          userName={name}
          onRemoveFriend={() => setIsRemoveOpen(true)}
        />
      </Box>
    </Flex>
  )
}

/**
 * The centred card: a big lock (or block) badge, what the relationship is,
 * why the feed is empty, and full-size request buttons. Block and report stay
 * in the header's ⋮ menu.
 */
const NonFriendPanel = ({ user }: { user: UserWithFriendStatus }) => {
  const name = personName(user) || "This user"
  const actions = useFriendActions(user.id, name)
  const isBlocked = user.is_blocked
  const badgeTone = isBlocked
    ? "app.red"
    : `app.${getAvatarPaletteKey(user.id)}`

  return (
    <Flex justify="center" py={{ base: 10, md: 16 }} px={4}>
      <Stack
        align="center"
        gap={2}
        w="100%"
        maxW="380px"
        px={6}
        py={8}
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="xl"
        boxShadow="sm"
        textAlign="center"
      >
        <Box position="relative" mb={2}>
          <PersonAvatar user={user} size={84} />
          <Flex
            position="absolute"
            right="-4px"
            bottom="-4px"
            boxSize="32px"
            align="center"
            justify="center"
            borderRadius="full"
            borderWidth="3px"
            borderColor="bg.panel"
            bg={`${badgeTone}.primary`}
            color={`${badgeTone}.secondary`}
          >
            {isBlocked ? <MdBlock size={16} /> : <MdLockOutline size={16} />}
          </Flex>
        </Box>
        <Text
          fontSize="22px"
          fontWeight="700"
          lineHeight="1.25"
          color="app.text"
          lineClamp={2}
        >
          {name}
        </Text>
        <Text
          fontSize="15px"
          fontWeight="700"
          color={isBlocked ? "app.red.secondary" : "app.text"}
        >
          {isBlocked
            ? "You've blocked this account"
            : user.received_request
              ? `${name} wants to be your friend`
              : user.sent_request
                ? "Friend request sent"
                : "You're not friends yet"}
        </Text>
        <Text
          fontSize="14px"
          lineHeight="1.45"
          color="app.textSecondary"
          mb={4}
        >
          {isBlocked
            ? `Unblock ${name} to send or receive friend requests and invites again.`
            : user.sent_request
              ? `Once ${name} accepts, you'll see their agenda here and can invite them to screenings.`
              : `Become friends to see ${name}'s agenda and invite them to screenings.`}
        </Text>
        {isBlocked ? null : user.received_request ? (
          <Flex gap={3} alignSelf="stretch">
            <Box flex="1" display="grid">
              <FriendButton
                large
                onClick={() => actions.decline.mutate()}
                busy={actions.decline.isPending}
              >
                Decline
              </FriendButton>
            </Box>
            <Box flex="1" display="grid">
              <FriendButton
                large
                primary
                icon={<MdCheck size={18} />}
                onClick={() => actions.accept.mutate()}
                busy={actions.accept.isPending}
              >
                Accept
              </FriendButton>
            </Box>
          </Flex>
        ) : (
          <Box alignSelf="stretch" display="grid">
            {user.sent_request ? (
              <FriendButton
                large
                onClick={() => actions.cancel.mutate()}
                busy={actions.cancel.isPending}
              >
                Cancel Request
              </FriendButton>
            ) : (
              <FriendButton
                large
                primary
                icon={<MdPersonAddAlt size={18} />}
                onClick={() => actions.send.mutate()}
                busy={actions.send.isPending}
              >
                Add Friend
              </FriendButton>
            )}
          </Box>
        )}
      </Stack>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// A cinema.
// ---------------------------------------------------------------------------

type CinemaLike = {
  id: number
  name: string
  url: string
  badge_bg_color: string
  cineville: boolean
  /** Absent from an older API and from a cinema built out of route params. */
  kind?: CinemaPublic["kind"]
  city: { name: string }
}

const CinemaHeader = ({
  cinema,
  onClose,
}: { cinema: CinemaLike; onClose?: () => void }) => {
  const palette = getCinemaPaletteKey(cinema)
  const mapsQuery = [cinema.name, cinema.city.name].filter(Boolean).join(", ")
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`

  return (
    <HeaderCard onClose={onClose} closeLabel="Stop showing only this cinema">
      <Box
        alignSelf="stretch"
        w="6px"
        flexShrink={0}
        borderRadius="full"
        // The palette's border shade: a fill (`primary`) is pale in light mode
        // and near-black in dark, and a stripe has nothing on it to read.
        bg={`app.${palette}.border`}
      />
      <Stack gap={1} flex="1" minW={0}>
        <Flex align="baseline" gap={3} wrap="wrap">
          {cinema.url ? (
            <Link
              href={cinema.url}
              target="_blank"
              rel="noopener noreferrer"
              fontSize="xl"
              fontWeight="700"
              lineHeight="1.2"
              color={`app.${palette}.secondary`}
              _hover={{ textDecoration: "underline" }}
            >
              {cinema.name}
            </Link>
          ) : (
            <Text
              fontSize="xl"
              fontWeight="700"
              lineHeight="1.2"
              color={`app.${palette}.secondary`}
            >
              {cinema.name}
            </Text>
          )}
          {/* What the place is. A festival's `cineville` only says Cineville
              lists it — the pass covers part of a festival, per screening
              (`cineville_pass`) — so a festival says it's a festival. */}
          {cinema.kind === "festival" || cinema.kind === "venue" ? (
            <Text fontSize="xs" fontWeight="600" color="fg.muted">
              {cinema.kind === "festival" ? "Film festival" : "Festival venue"}
            </Text>
          ) : cinema.cineville ? (
            <Text fontSize="xs" fontWeight="600" color="fg.muted">
              Cineville
            </Text>
          ) : null}
        </Flex>
        <Flex align="center" gap={4} wrap="wrap" fontSize="sm">
          {cinema.city.name ? (
            <Link
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              color="fg.muted"
              display="inline-flex"
              alignItems="center"
              gap={1}
            >
              <FiMapPin />
              <IconLabel>{cinema.city.name}</IconLabel>
            </Link>
          ) : null}
          {cinema.url ? (
            <Link
              href={cinema.url}
              target="_blank"
              rel="noopener noreferrer"
              color="fg.muted"
              display="inline-flex"
              alignItems="center"
              gap={1}
            >
              <FiExternalLink />
              <IconLabel>Website</IconLabel>
            </Link>
          ) : null}
        </Flex>
      </Stack>
    </HeaderCard>
  )
}

export default FeedSubjectHeader
