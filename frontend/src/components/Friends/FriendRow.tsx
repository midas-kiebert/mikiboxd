/**
 * One person on the Friends page — the app's `FriendCard`, on the web.
 *
 * The row adapts to the relationship, so the page never has to know the
 * difference: a request carries Decline / Accept, a sent request Cancel, a
 * stranger Add, and a friend the per-friend "Can see your showtimes" choice.
 * The name is a link to that person's agenda (the feed narrowed to them),
 * which for someone who is not a friend yet is where adding them lives too.
 *
 * Where the app puts a friend's visibility choice under a divider, a web row
 * has the width to hold it beside the name; it wraps under only when the
 * list is narrow. Remove, block and report sit in the ⋮ menu — rare, and not
 * worth a button each.
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { MdCheck, MdChevronRight, MdPersonAddAlt } from "react-icons/md"
import type { UserWithFriendStatus } from "shared"

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
import { friendFeedSearch } from "@/features/showtimes/feed-params"

type FriendRowProps = {
  user: UserWithFriendStatus
  /**
   * Say what the relationship is under the name. Off where a section heading
   * already says it for every row; on in search results, which mix them.
   */
  showStatus?: boolean
}

type RelationStatus = { label: string; tone: "green" | "orange" }

const relationStatus = (user: UserWithFriendStatus): RelationStatus | null => {
  if (user.is_friend) return { label: "Friend", tone: "green" }
  if (user.received_request)
    return { label: "Sent you a request", tone: "orange" }
  if (user.sent_request) return { label: "Request pending", tone: "orange" }
  return null
}

const FriendRow = ({ user, showStatus = false }: FriendRowProps) => {
  // Read flow: data and actions first, then the row's two ends, then JSX.
  const name = personName(user)
  const actions = useFriendActions(user.id, name)
  const [isRemoveOpen, setIsRemoveOpen] = useState(false)
  const status = showStatus ? relationStatus(user) : null

  // A blocked account gets nothing here: Unblock is in the ⋮ menu.
  let trailing: ReactNode = null
  if (user.is_blocked) {
    trailing = null
  } else if (user.is_friend) {
    trailing = (
      <FriendVisibilityChoice
        friendId={user.id}
        name={name}
        sharesStatus={user.shares_status !== false}
      />
    )
  } else if (user.received_request) {
    trailing = (
      <Flex gap={2}>
        <FriendButton
          onClick={() => actions.decline.mutate()}
          busy={actions.isBusy}
          label={`Decline ${name}`}
        >
          Decline
        </FriendButton>
        <FriendButton
          primary
          icon={<MdCheck size={15} />}
          onClick={() => actions.accept.mutate()}
          busy={actions.isBusy}
          label={`Accept ${name}`}
        >
          Accept
        </FriendButton>
      </Flex>
    )
  } else if (user.sent_request) {
    trailing = (
      <FriendButton
        onClick={() => actions.cancel.mutate()}
        busy={actions.isBusy}
        label={`Cancel your request to ${name}`}
      >
        Cancel
      </FriendButton>
    )
  } else {
    trailing = (
      <FriendButton
        primary
        icon={<MdPersonAddAlt size={15} />}
        onClick={() => actions.send.mutate()}
        busy={actions.isBusy}
        label={`Add ${name}`}
      >
        Add
      </FriendButton>
    )
  }

  // Render/output using the state and derived values prepared above.
  return (
    <Flex
      align="center"
      wrap="wrap"
      gap="10px 16px"
      px="14px"
      py="12px"
      bg="app.cardBackground"
      borderWidth="1px"
      borderColor="app.cardBorder"
      borderRadius="14px"
      opacity={actions.isBusy ? 0.6 : 1}
      transition="opacity 120ms ease"
    >
      <Flex
        asChild
        align="center"
        gap="12px"
        flex="1 1 200px"
        minW={0}
        mx="-6px"
        px="6px"
        py="4px"
        borderRadius="10px"
        transition="background-color 120ms ease"
        _hover={{
          bg: "bg.muted",
          "& [data-person-name]": { textDecoration: "underline" },
        }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "app.tint",
          outlineOffset: "1px",
        }}
      >
        <Link to="/" search={friendFeedSearch(user.id)}>
          <PersonAvatar user={user} size={40} />
          <Box minW={0}>
            <Text
              data-person-name
              fontSize="15px"
              fontWeight="700"
              lineHeight="1.3"
              color="app.text"
              textUnderlineOffset="2px"
              truncate
            >
              {name}
            </Text>
            {user.is_blocked ? (
              <Text fontSize="12px" fontWeight="600" color="app.red.secondary">
                Blocked
              </Text>
            ) : status ? (
              <Flex align="center" gap="6px" mt="1px">
                <Box
                  boxSize="6px"
                  borderRadius="full"
                  bg={`app.${status.tone}.secondary`}
                />
                <Text
                  fontSize="12px"
                  fontWeight="600"
                  color="app.textSecondary"
                  truncate
                >
                  {status.label}
                </Text>
              </Flex>
            ) : null}
          </Box>
          <Box
            as={MdChevronRight}
            boxSize="20px"
            flexShrink={0}
            color="fg.subtle"
            aria-hidden
          />
        </Link>
      </Flex>

      {/* Grows into whatever the name leaves, so it sits at the right end
          beside the name and spans the row once it wraps under it. */}
      <Flex
        align="flex-end"
        justify="flex-end"
        gap={1}
        flex="1 0 auto"
        maxW="100%"
      >
        {trailing}
        <Box
          alignSelf={user.is_friend ? "flex-end" : "center"}
          pb={user.is_friend ? "2px" : 0}
        >
          <UserModerationMenu
            userId={user.id}
            userName={name}
            isBlocked={user.is_blocked}
            onRemoveFriend={
              user.is_friend ? () => setIsRemoveOpen(true) : undefined
            }
          />
        </Box>
      </Flex>

      {user.is_friend ? (
        <RemoveFriendDialog
          name={name}
          open={isRemoveOpen}
          onClose={() => setIsRemoveOpen(false)}
          onConfirm={() => actions.remove.mutate()}
        />
      ) : null}
    </Flex>
  )
}

export default FriendRow
