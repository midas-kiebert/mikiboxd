/**
 * "Invite them first?", asked in two places, as the app asks it:
 *
 *   - right before a screening's visibility switches to "Invited only", when
 *     friends are already going or interested but were never invited — left
 *     alone, the switch silently hides your status from exactly the people
 *     you are going with (the default copy);
 *   - right before you first mark a screening going or interested, when
 *     friends already attending would not see it as things stand — your mode
 *     or a per-friend opt-out hides it from them (the caller's copy).
 *
 * Every friend starts ticked, since the default is to keep people in the loop.
 * The app's dialog (`mobile/components/showtimes/InviteBeforePrivateDialog`),
 * in its words and with its icon. Closing it any other way — Esc, the
 * backdrop — counts as Skip, as it does there: the choice was already made,
 * and the question was only whether to invite anyone on the way.
 */
import { Box, Dialog, Flex, Portal, Text } from "@chakra-ui/react"
import { useState } from "react"
import type { UserPublic } from "shared"

import {
  PanelActionButton,
  PanelPressable,
} from "@/components/Showtimes/detail/PanelChrome"
import {
  PersonAvatar,
  personName,
} from "@/components/Showtimes/detail/PersonAvatar"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"

/** How tall the list may get before it scrolls inside the dialog. */
const LIST_MAX_HEIGHT = "260px"

const DEFAULT_TITLE = "Keep these friends in the loop?"
const DEFAULT_MESSAGE =
  "These friends already see your status here but haven't been invited. " +
  "Switching to invite-only will hide it from them unless you invite them now."

type InviteBeforePrivateDialogProps = {
  open: boolean
  /** Who would lose sight of you. Kept while closing, so the list doesn't
      empty out under the close animation. */
  friends: readonly UserPublic[]
  onConfirm: (selected: UserPublic[]) => void
  onSkip: () => void
  title?: string
  message?: string
}

const InviteBeforePrivateDialog = ({
  open,
  friends,
  onConfirm,
  onSkip,
  title = DEFAULT_TITLE,
  message = DEFAULT_MESSAGE,
}: InviteBeforePrivateDialogProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(friends.map((friend) => friend.id)),
  )
  // Everyone ticked again on each open, so a friend unticked last time is not
  // quietly left out this time.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSelectedIds(new Set(friends.map((friend) => friend.id)))
  }

  const toggle = (friendId: string) =>
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(friendId)) next.delete(friendId)
      else next.add(friendId)
      return next
    })

  const selected = friends.filter((friend) => selectedIds.has(friend.id))

  // Render/output using the state and derived values prepared above.
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onSkip()
      }}
      placement="center"
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content
            w="100%"
            maxW="380px"
            p="20px"
            borderRadius="16px"
            bg="bg.panel"
          >
            <Flex
              align="center"
              justify="center"
              boxSize="40px"
              mb="10px"
              borderRadius="full"
              bg="app.surfaceMuted"
              color="app.tint"
            >
              <Box as={PanelIcon.visibilityOff} boxSize="20px" aria-hidden />
            </Flex>

            <Dialog.Title fontSize="16px" fontWeight="700" lineHeight="1.3">
              {title}
            </Dialog.Title>
            <Dialog.Description
              fontSize="13px"
              color="fg.muted"
              lineHeight="1.5"
              mt="4px"
            >
              {message}
            </Dialog.Description>

            <Box
              maxH={LIST_MAX_HEIGHT}
              overflowY="auto"
              overscrollBehavior="contain"
              mt="12px"
              mx="-6px"
            >
              {friends.map((friend) => {
                const isOn = selectedIds.has(friend.id)

                return (
                  <PanelPressable
                    type="button"
                    key={friend.id}
                    // biome-ignore lint/a11y/useSemanticElements: ARIA checkbox pattern on a styled button; a native checkbox cannot take this styling
                    role="checkbox"
                    aria-checked={isOn}
                    onClick={() => toggle(friend.id)}
                    display="flex"
                    alignItems="center"
                    gap="10px"
                    w="100%"
                    px="6px"
                    py="6px"
                    borderRadius="8px"
                    bg="transparent"
                    cursor="pointer"
                    textAlign="left"
                    transition="background-color 120ms ease"
                    _hover={{ bg: "bg.subtle" }}
                    _focusVisible={{
                      outline: "2px solid",
                      outlineColor: "app.tint",
                      outlineOffset: "-2px",
                    }}
                  >
                    <PersonAvatar user={friend} size={28} />
                    <Text
                      fontSize="14px"
                      fontWeight="600"
                      flex="1"
                      minW={0}
                      truncate
                    >
                      {personName(friend)}
                    </Text>
                    <Flex
                      as="span"
                      align="center"
                      justify="center"
                      flexShrink={0}
                      boxSize="20px"
                      borderRadius="5px"
                      borderWidth="2px"
                      borderColor={isOn ? "app.tint" : "border"}
                      bg={isOn ? "app.tint" : "transparent"}
                      color="app.pillActiveText"
                      transition="background-color 120ms ease, border-color 120ms ease"
                    >
                      {isOn ? (
                        <Box as={PanelIcon.check} boxSize="14px" aria-hidden />
                      ) : null}
                    </Flex>
                  </PanelPressable>
                )
              })}
            </Box>

            <Flex gap="8px" mt="16px">
              <Box display="grid" flex="1">
                <PanelActionButton onClick={onSkip}>Skip</PanelActionButton>
              </Box>
              <Box display="grid" flex="1">
                <PanelActionButton primary onClick={() => onConfirm(selected)}>
                  {selected.length > 0 ? "Invite & continue" : "Continue"}
                </PanelActionButton>
              </Box>
            </Flex>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

export default InviteBeforePrivateDialog
