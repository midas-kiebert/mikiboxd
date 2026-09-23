/**
 * The pieces every place about a person on the web is built from — the
 * Friends page's rows and the feed's friend header (`FeedSubjectHeader`) —
 * so the two draw the same buttons, the same visibility choice and the same
 * remove dialog, the way the app's `FriendCard` and `FriendAgendaOptions` do.
 *
 *   - `useFriendActions` — the five friendship writes, with their refreshes.
 *   - `FriendButton`     — the app's primary / outline / destructive button.
 *   - `FriendVisibilityChoice` — "Can see your showtimes: Always | Only when
 *     invited", the app's `FriendVisibilityControl`.
 *   - `RemoveFriendDialog` — the confirm step before removing a friend.
 */
import { Flex, Portal, Stack, Text, chakra } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { MdLockOutline, MdVisibility } from "react-icons/md"
import { FriendsService } from "shared/client"
import { useFriendStatusSharing } from "shared/hooks/useFriendStatusSharing"

import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"
import { IconLabel } from "@/components/ui/icon-label"
import useCustomToast from "@/hooks/useCustomToast"

/**
 * Send, accept, decline, cancel, remove — for one person. Accepting and
 * removing also refresh the showtimes, since whose plans a showtime shows
 * depends on who your friends are.
 */
export const useFriendActions = (userId: string, name: string) => {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] })
  const refreshAll = () => {
    refresh()
    queryClient.invalidateQueries({ queryKey: ["showtimes"] })
  }
  const failed = (what: string) => () =>
    showErrorToast(`Could not ${what}. Try again.`)

  const send = useMutation({
    mutationFn: () => FriendsService.sendFriendRequest({ receiverId: userId }),
    onSuccess: refresh,
    onError: failed("send the friend request"),
  })
  const accept = useMutation({
    mutationFn: () => FriendsService.acceptFriendRequest({ senderId: userId }),
    onSuccess: refreshAll,
    onError: failed("accept the friend request"),
  })
  const decline = useMutation({
    mutationFn: () => FriendsService.declineFriendRequest({ senderId: userId }),
    onSuccess: refresh,
    onError: failed("decline the friend request"),
  })
  const cancel = useMutation({
    mutationFn: () =>
      FriendsService.cancelFriendRequest({ receiverId: userId }),
    onSuccess: refresh,
    onError: failed("cancel the friend request"),
  })
  const remove = useMutation({
    mutationFn: () => FriendsService.removeFriend({ friendId: userId }),
    onSuccess: () => {
      showSuccessToast(`${name} is no longer your friend.`)
      refreshAll()
    },
    onError: failed("remove this friend"),
  })

  return {
    send,
    accept,
    decline,
    cancel,
    remove,
    isBusy:
      send.isPending ||
      accept.isPending ||
      decline.isPending ||
      cancel.isPending ||
      remove.isPending,
  }
}

/**
 * The app's two button shapes (`NonFriendProfile`): primary is solid tint
 * with white text, the other a hairline outline in the secondary text colour;
 * destructive is the confirm dialogs' red. Sized for a row.
 */
export const FriendButton = ({
  children,
  onClick,
  primary = false,
  destructive = false,
  busy = false,
  large = false,
  icon,
  label,
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
  destructive?: boolean
  busy?: boolean
  icon?: ReactNode
  /** The accessible name, when the visible word needs its person ("Accept Sam"). */
  label?: string
  /** The app's full-size call to action (`NonFriendProfile`), not a row's. */
  large?: boolean
}) => (
  <chakra.button
    type="button"
    onClick={onClick}
    disabled={busy}
    aria-label={label}
    display="inline-flex"
    alignItems="center"
    justifyContent="center"
    gap="6px"
    minH={large ? "46px" : "34px"}
    px={large ? "20px" : "14px"}
    borderRadius={large ? "14px" : "10px"}
    borderWidth="1px"
    fontSize={large ? "15px" : "13px"}
    fontWeight="700"
    whiteSpace="nowrap"
    cursor="pointer"
    transition="filter 120ms ease, background-color 120ms ease"
    _disabled={{ opacity: 0.6, cursor: "default" }}
    _focusVisible={{
      outline: "2px solid",
      outlineColor: "app.tint",
      outlineOffset: "2px",
    }}
    {...(primary
      ? {
          bg: "app.tint",
          borderColor: "app.tint",
          color: "app.pillActiveText",
          _hover: { filter: "brightness(1.08)" },
        }
      : destructive
        ? {
            bg: "app.red.primary",
            borderColor: "app.red.border",
            color: "app.red.secondary",
            _hover: { filter: "brightness(0.97)" },
          }
        : {
            bg: "transparent",
            borderColor: "app.cardBorder",
            color: "app.textSecondary",
            _hover: { bg: "bg.muted" },
          })}
  >
    {icon}
    <IconLabel>{children}</IconLabel>
  </chakra.button>
)

/**
 * "Can see your showtimes: Always | Only when invited" — the app's
 * `FriendVisibilityControl`: both answers side by side on a hairline track,
 * the chosen one on a thumb tinted green (open) or amber (restricted), with
 * the label's icon following it. Answers in the click's own frame; the write
 * is debounced and serialized by `shared/hooks/useFriendStatusSharing`, the app's own, and
 * falls back to the server's value if it fails.
 */
const VISIBILITY_OPTIONS = [
  {
    sharesStatus: true,
    label: "Always",
    tone: "green",
    hint: "on every showtime you pick",
  },
  {
    sharesStatus: false,
    label: "Only when invited",
    tone: "orange",
    hint: "only on showtimes you invite them to",
  },
] as const

export const FriendVisibilityChoice = ({
  friendId,
  name,
  sharesStatus,
}: {
  friendId: string
  name: string
  sharesStatus: boolean
}) => {
  const { showErrorToast } = useCustomToast()
  // Holds the picked answer until the server agrees, and never has more than
  // one write per friend in flight — see the hook. Letting go as each write
  // settled let the refetch from one friend's write, landing while the next
  // friend's was still queued, paint that friend's old answer back.
  const { sharesStatus: shares, change } = useFriendStatusSharing(
    friendId,
    sharesStatus,
    () => showErrorToast("That didn't save. Try again."),
  )
  const selected =
    VISIBILITY_OPTIONS.find((option) => option.sharesStatus === shares) ??
    VISIBILITY_OPTIONS[0]

  return (
    <Stack
      gap="4px"
      w={{ base: "100%", sm: "280px" }}
      flex={{ base: "1", sm: "none" }}
      minW={0}
    >
      <Flex align="center" justify="space-between" gap={2}>
        <Flex align="center" gap="5px" color={`app.${selected.tone}.secondary`}>
          {shares ? <MdVisibility size={13} /> : <MdLockOutline size={13} />}
          <Text
            fontSize="11px"
            fontWeight="600"
            letterSpacing="0.2px"
            color="app.textSecondary"
          >
            <IconLabel>Can see your showtimes:</IconLabel>
          </Text>
        </Flex>
      </Flex>
      <Flex
        role="radiogroup"
        aria-label={`Who can see your showtimes — ${name}`}
        gap="3px"
        p="3px"
        borderRadius="10px"
        borderWidth="1px"
        borderColor="app.pillBorder"
        bg="app.cardBackground"
      >
        {VISIBILITY_OPTIONS.map((option) => {
          const isOn = option.sharesStatus === shares
          return (
            <chakra.button
              key={option.label}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: ARIA radio pattern on a styled button; a native radio input cannot take this styling
              role="radio"
              aria-checked={isOn}
              aria-label={`${option.label} — ${option.hint}`}
              flex="1"
              minH="28px"
              px="6px"
              borderRadius="8px"
              fontSize="12px"
              fontWeight={isOn ? "700" : "600"}
              whiteSpace="nowrap"
              cursor={isOn ? "default" : "pointer"}
              bg={isOn ? `app.${option.tone}.primary` : "transparent"}
              color={
                isOn ? `app.${option.tone}.secondary` : "app.textSecondary"
              }
              boxShadow={isOn ? "0 1px 4px rgba(0, 0, 0, 0.08)" : undefined}
              transition="background-color 160ms ease, color 160ms ease"
              _hover={isOn ? undefined : { bg: "bg.muted" }}
              onClick={() => {
                if (isOn) return
                change(option.sharesStatus)
              }}
            >
              {option.label}
            </chakra.button>
          )
        })}
      </Flex>
    </Stack>
  )
}

/** The app's `ConfirmDialog` for removing a friend, in its words. */
export const RemoveFriendDialog = ({
  name,
  open,
  onClose,
  onConfirm,
}: {
  name: string
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) => (
  <DialogRoot
    open={open}
    onOpenChange={(details) => {
      if (!details.open) onClose()
    }}
    role="alertdialog"
  >
    <Portal>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text fontSize="sm" color="app.textSecondary">
            You will no longer see each other's showtimes, and neither of you
            can send invites until you are friends again.
          </Text>
        </DialogBody>
        <DialogFooter>
          <FriendButton onClick={onClose}>Cancel</FriendButton>
          <FriendButton
            destructive
            onClick={() => {
              // Closed on the press itself; the request follows.
              onClose()
              onConfirm()
            }}
          >
            Remove
          </FriendButton>
        </DialogFooter>
      </DialogContent>
    </Portal>
  </DialogRoot>
)
