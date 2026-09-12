/**
 * Inviting people to a screening.
 *
 * What this replaces was an always-open list of every friend with an "Invite"
 * button repeated down the right-hand edge — a column of identical buttons
 * that made the panel look like a settings screen and buried everything under
 * it. Invites are a thing you do occasionally, so the resting state is now the
 * *result* (who is invited, and whether they have looked), and the act of
 * inviting is one button that opens a picker.
 *
 * The picker is multi-select and sends in one go, because inviting is almost
 * always plural: you are asking the three people you would actually go with,
 * not sending one invitation and reconsidering. It orders friends by how
 * likely they are to say yes — anyone who has the film watchlisted first, then
 * everyone else alphabetically — which is the ordering the flat list never had.
 *
 * Hidden entirely for a guest rather than gated on press. That is the
 * exception to the app's guest rule and it holds here for the reason the rule
 * exists: a signed-out visitor has no friends list, so there is nothing behind
 * this to discover. The status buttons above still gate, because those do have
 * something to show for signing in.
 *
 * Arranged as the app arranges it: an "Invited" list of who you have asked and
 * whether they have looked, then a bar at the foot of the panel holding Share
 * beside a collapsible "Invite friends". Share is deliberately *not* the app's
 * native share sheet — it copies a signed link to the clipboard, which is the
 * web's own answer and the one kept here on request. The token is server-minted
 * and signed rather than the sender's id, so the receiving end can prove who
 * sent it and the link cannot be forged by swapping an id in the URL.
 *
 * The sent-pings query and every mutation over it are
 * `features/showtimes/useShowtimeInvites`, not this file's: the watch lists in
 * the audience box invite people too, and two copies of "who is already
 * invited" would disagree.
 */
import { Box, Flex, Input, Text } from "@chakra-ui/react"
import { useEffect, useMemo, useState } from "react"
import type { SentShowtimePingPublic, ShowtimePublic } from "shared"
import { useFetchFriends } from "shared/hooks/useFetchFriends"

import { useIsSignedIn } from "@/auth/useSession"
import {
  PanelActionButton,
  PanelEmpty,
  PanelIconButton,
  PanelPressable,
} from "@/components/Showtimes/detail/PanelChrome"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import {
  PersonAvatar,
  PersonChip,
  personName,
} from "@/components/Showtimes/detail/PersonAvatar"
import { Tooltip } from "@/components/ui/tooltip"
import { useShowtimeInvites } from "@/features/showtimes/useShowtimeInvites"

/** Past this many friends the list is worth searching rather than scanning. */
const SEARCH_THRESHOLD = 8

/** How tall the picker may get before it scrolls inside itself. */
const PICKER_MAX_HEIGHT = "220px"

type ShowtimeInvitePanelProps = {
  showtime: ShowtimePublic
}

const ShowtimeInvitePanel = ({ showtime }: ShowtimeInvitePanelProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const showtimeId = showtime.id
  const isSignedIn = useIsSignedIn()

  const [isPicking, setIsPicking] = useState(false)
  const [search, setSearch] = useState("")
  const [chosenIds, setChosenIds] = useState<string[]>([])

  // A picker left open over one screening has nothing to do with the next one,
  // and a half-made selection carried across would send invites to the wrong
  // showtime on the next press.
  useEffect(() => {
    setIsPicking(false)
    setSearch("")
    setChosenIds([])
  }, [showtimeId])

  const { data: friends } = useFetchFriends({ enabled: isSignedIn })

  const {
    sentPings,
    pingByFriendId,
    sendInvites,
    isSending,
    uninvite,
    nudge,
    copyInviteLink,
    isBuildingLink,
  } = useShowtimeInvites(showtimeId)

  /**
   * Who is worth asking, best guess first: the friends who already want to see
   * the film, then everyone else by name.
   */
  const candidates = useMemo(() => {
    const keenIds = new Set(
      (showtime.viewer?.friends_watchlisted ?? []).map((friend) => friend.id),
    )
    const term = search.trim().toLowerCase()

    return (friends ?? [])
      .filter((friend) =>
        term ? personName(friend).toLowerCase().includes(term) : true,
      )
      .sort((left, right) => {
        const keenDifference = Number(keenIds.has(right.id)) - Number(keenIds.has(left.id))
        if (keenDifference !== 0) return keenDifference
        return personName(left).localeCompare(personName(right))
      })
  }, [friends, search, showtime.viewer?.friends_watchlisted])

  /**
   * Read off the invites themselves rather than off the friends list: a ping
   * carries the name it was sent to, so somebody you invited still shows here
   * while the friends list is loading, and after they have stopped being a
   * friend.
   */
  const invited = useMemo(
    () =>
      (sentPings ?? []).map((ping) => ({
        ping,
        user: { id: ping.receiver_id, display_name: ping.receiver_name },
      })),
    [sentPings],
  )

  // A section that could only ever be empty is hidden rather than gated.
  if (!isSignedIn) return null

  const toggleChosen = (friendId: string) =>
    setChosenIds((current) =>
      current.includes(friendId)
        ? current.filter((id) => id !== friendId)
        : [...current, friendId],
    )

  /** "Seen" / "Pending" / "Dismissed" — the app's three words for an invite. */
  const inviteStatus = (
    ping: SentShowtimePingPublic,
  ): { label: string; color: string } => {
    if (ping.dismissed_at) return { label: "Dismissed", color: "app.red.secondary" }
    if (ping.seen_at) return { label: "Seen", color: "app.green.secondary" }
    return { label: "Pending", color: "fg.subtle" }
  }

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <Box px={3} py={2} borderTopWidth="1px" borderColor="border.muted">
        <Text
          fontSize="11px"
          fontWeight="700"
          textTransform="uppercase"
          letterSpacing="0.4px"
          color="fg.muted"
          mb="6px"
        >
          Invited
        </Text>

        {invited.length ? (
          <Flex direction="column" gap="2px">
            {invited.map(({ ping, user }) => {
              const status = inviteStatus(ping)

              return (
                <PersonChip
                  key={ping.id}
                  user={user}
                  caption="Invited by you"
                  trailing={
                    <>
                      <Text
                        fontSize="11px"
                        fontWeight="600"
                        color={status.color}
                        flexShrink={0}
                      >
                        {status.label}
                      </Text>
                      {/* Nudging only makes sense for someone who has not looked. */}
                      {ping.seen_at ? null : (
                        <PanelIconButton
                          label={`Nudge ${personName(user)}`}
                          onClick={() => nudge(user.id)}
                        >
                          <Box as={PanelIcon.notificationsNone} boxSize="15px" />
                        </PanelIconButton>
                      )}
                      <PanelIconButton
                        label={`Take back ${personName(user)}'s invite`}
                        onClick={() => uninvite(user.id)}
                        tone="danger"
                      >
                        <Box as={PanelIcon.close} boxSize="14px" />
                      </PanelIconButton>
                    </>
                  }
                />
              )
            })}
          </Flex>
        ) : (
          <PanelEmpty>You haven&apos;t invited anyone yet.</PanelEmpty>
        )}
      </Box>

      {/* Share is one press and never expands; inviting folds a picker out
          underneath. Both are tinted blue, the app's coding for an invite. */}
      <Box px={3} pb={3}>
        <Flex gap="6px">
          <PanelPressable
            type="button"
            onClick={() => copyInviteLink()}
            disabled={isBuildingLink}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap="6px"
            px="12px"
            py="8px"
            borderRadius="10px"
            borderWidth="1px"
            borderColor="app.blue.border"
            bg="app.blue.primary"
            color="app.blue.secondary"
            fontSize="13px"
            fontWeight="700"
            cursor={isBuildingLink ? "not-allowed" : "pointer"}
            opacity={isBuildingLink ? 0.5 : 1}
            transition="background-color 120ms ease"
            _focusVisible={{
              outline: "2px solid",
              outlineColor: "app.tint",
              outlineOffset: "1px",
            }}
          >
            {/* A link, not the app's share glyph: this copies a URL rather than
                handing it to a share sheet, and the icon should say so. */}
            <Box as={PanelIcon.shareLink} boxSize="16px" aria-hidden />
            Share
          </PanelPressable>

          <PanelPressable
            type="button"
            onClick={() => setIsPicking((picking) => !picking)}
            aria-expanded={isPicking}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap="6px"
            flex="1"
            minW={0}
            px="12px"
            py="8px"
            borderRadius="10px"
            borderWidth="1px"
            borderColor="app.blue.border"
            bg="app.blue.primary"
            color="app.blue.secondary"
            fontSize="13px"
            fontWeight="700"
            cursor="pointer"
            transition="background-color 120ms ease"
            _focusVisible={{
              outline: "2px solid",
              outlineColor: "app.tint",
              outlineOffset: "1px",
            }}
          >
            <Box as={PanelIcon.mailOutline} boxSize="18px" aria-hidden />
            <Box as="span" truncate>
              Invite friends
            </Box>
            <Box
              as={PanelIcon.expandMore}
              boxSize="20px"
              flexShrink={0}
              transition="transform 160ms ease"
              transform={isPicking ? "rotate(180deg)" : "rotate(0deg)"}
              aria-hidden
            />
          </PanelPressable>
        </Flex>

        {isPicking ? (
          <Box
            mt="6px"
            borderWidth="1px"
            borderColor="border"
            borderRadius="10px"
            overflow="hidden"
          >
            {friends?.length === 0 ? (
              <Box px="10px" py="10px">
                <PanelEmpty>Add friends to invite them to a screening.</PanelEmpty>
              </Box>
            ) : (
              <>
                {(friends?.length ?? 0) > SEARCH_THRESHOLD ? (
                  <Flex
                    align="center"
                    gap={2}
                    px={2}
                    py="6px"
                    borderBottomWidth="1px"
                    borderColor="border.muted"
                  >
                    <Box
                      as={PanelIcon.search}
                      boxSize="15px"
                      color="fg.subtle"
                      flexShrink={0}
                    />
                    <Input
                      autoFocus
                      variant="flushed"
                      size="sm"
                      border="none"
                      fontSize="13px"
                      placeholder="Search friends"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label="Search friends"
                      _focusVisible={{ borderColor: "transparent", boxShadow: "none" }}
                    />
                  </Flex>
                ) : null}

                <Box
                  maxH={PICKER_MAX_HEIGHT}
                  overflowY="auto"
                  overscrollBehavior="contain"
                  p="4px"
                >
                  {candidates.map((friend) => {
                    const isChosen = chosenIds.includes(friend.id)
                    const alreadyInvited = pingByFriendId.has(friend.id)

                    return (
                      <PanelPressable
                        type="button"
                        key={friend.id}
                        onClick={() => toggleChosen(friend.id)}
                        aria-pressed={isChosen}
                        display="flex"
                        alignItems="center"
                        gap={2}
                        w="100%"
                        px="6px"
                        py="5px"
                        borderRadius="8px"
                        cursor="pointer"
                        textAlign="left"
                        transition="background-color 120ms ease"
                        bg={isChosen ? "app.blue.primary" : "transparent"}
                        _hover={{ bg: isChosen ? "app.blue.primary" : "bg.subtle" }}
                        _focusVisible={{
                          outline: "2px solid",
                          outlineColor: "app.tint",
                          outlineOffset: "-2px",
                        }}
                      >
                        <Box
                          as={
                            isChosen
                              ? PanelIcon.radioButtonChecked
                              : PanelIcon.radioButtonUnchecked
                          }
                          boxSize="18px"
                          flexShrink={0}
                          color={isChosen ? "app.blue.secondary" : "fg.subtle"}
                          aria-hidden
                        />
                        <PersonAvatar user={friend} size={20} />
                        <Text fontSize="13px" truncate flex="1" minW={0}>
                          {personName(friend)}
                        </Text>
                        {alreadyInvited ? (
                          <Tooltip content="Already invited" showArrow>
                            <Box
                              as={PanelIcon.checkCircle}
                              boxSize="14px"
                              color="fg.subtle"
                              flexShrink={0}
                            />
                          </Tooltip>
                        ) : null}
                      </PanelPressable>
                    )
                  })}

                  {candidates.length === 0 ? (
                    <Box px="6px" py="8px">
                      <PanelEmpty>No friends found.</PanelEmpty>
                    </Box>
                  ) : null}
                </Box>

                <Flex gap="6px" p="6px" borderTopWidth="1px" borderColor="border.muted">
                  <PanelActionButton
                    primary
                    fullWidth
                    icon={PanelIcon.mailOutline}
                    disabled={chosenIds.length === 0 || isSending}
                    onClick={() => {
                      sendInvites(
                        chosenIds.map((friendId) => ({
                          friendId,
                          name: personName(
                            candidates.find((friend) => friend.id === friendId) ?? {
                              id: friendId,
                              display_name: null,
                            },
                          ),
                        })),
                      )
                      setIsPicking(false)
                      setChosenIds([])
                      setSearch("")
                    }}
                  >
                    {chosenIds.length > 1 ? `Invite ${chosenIds.length}` : "Invite"}
                  </PanelActionButton>
                  <PanelActionButton onClick={() => setIsPicking(false)}>
                    Cancel
                  </PanelActionButton>
                </Flex>
              </>
            )}
          </Box>
        ) : null}
      </Box>
    </>
  )
}

export default ShowtimeInvitePanel
