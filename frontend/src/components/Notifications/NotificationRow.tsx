/**
 * One row of the notification panel.
 *
 * The icon and accent per type are the app's (`mobile/components/notifications/
 * NotificationRow.tsx`), drawn with the same MaterialIcons glyphs from
 * `react-icons/md`; the wording is `shared/notifications/feed-copy`, so the two
 * clients describe the same event the same way.
 *
 * Where somebody caused the event, the row leads with their face and the type
 * rides on it as a small badge — "who" is what you scan a notification list
 * for. Seat alerts have nobody behind them, so they lead with the icon itself.
 *
 * The whole row is the link, through a link stretched over it rather than an
 * anchor around it: the row also holds buttons, and a button inside an anchor
 * is invalid and clicks through to the link.
 *
 * A screening opens in the side panel of the page you are on when it has one
 * (`showtime-panel-slot`), so reading a notification never takes you away from
 * what you were doing, and the notification panel stays open beside it so
 * the next one is a click away. The link to the film's page is the fallback,
 * and what a middle- or modifier-click still follows.
 */
import { Box, Button, Flex, Icon, Text } from "@chakra-ui/react"
import { Link as RouterLink } from "@tanstack/react-router"
import { DateTime } from "luxon"
import type { MouseEvent } from "react"
import type { IconType } from "react-icons"
import {
  MdClose,
  MdConfirmationNumber,
  MdEventBusy,
  MdGroups,
  MdHowToReg,
  MdLocalFireDepartment,
  MdMail,
  MdMarkEmailRead,
  MdPersonAdd,
} from "react-icons/md"
import type { NotificationFeedItem } from "shared"
import { getNotificationCopy } from "shared/notifications/feed-copy"

import { PersonAvatar } from "@/components/Showtimes/detail/PersonAvatar"
import { openInShowtimePanel } from "@/features/showtimes/showtime-panel-slot"

type NotificationType = NotificationFeedItem["type"]

/** The palette trio each type is drawn in, as `app.<name>.*`. */
type Accent = "teal" | "blue" | "purple" | "green" | "orange" | "redDeep"

const PRESENTATION: Record<
  NotificationType,
  { icon: IconType; accent: Accent }
> = {
  friend_showtime_match: { icon: MdGroups, accent: "teal" },
  invite_response: { icon: MdMarkEmailRead, accent: "blue" },
  showtime_invite: { icon: MdMail, accent: "blue" },
  friend_request_received: { icon: MdPersonAdd, accent: "purple" },
  friend_request_accepted: { icon: MdHowToReg, accent: "green" },
  seats_running_out: { icon: MdLocalFireDepartment, accent: "orange" },
  sold_out: { icon: MdEventBusy, accent: "redDeep" },
  seats_released: { icon: MdConfirmationNumber, accent: "green" },
}

const AVATAR_SIZE = 40

/**
 * "now", "12m", "3h", "2d", then the date: a column of times reads at a glance
 * only if each one is a few characters wide.
 */
export const formatNotificationTime = (iso: string): string => {
  const at = DateTime.fromISO(iso)
  if (!at.isValid) return ""
  const minutes = Math.floor(-at.diffNow("minutes").minutes)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return at.toFormat(
    at.hasSame(DateTime.now(), "year") ? "LLL d" : "LLL d, yyyy",
  )
}

/** Where pressing the row goes, or `null` for a row that only has buttons. */
const rowTarget = (item: NotificationFeedItem) => {
  if (item.showtime) {
    return {
      to: "/movie/$movieId" as const,
      params: { movieId: String(item.showtime.movie.id) },
      search: { showtime: item.showtime.id },
    }
  }
  if (item.type === "friend_request_accepted")
    return { to: "/friends" as const }
  return null
}

const Leading = ({ item }: { item: NotificationFeedItem }) => {
  const { icon, accent } = PRESENTATION[item.type]

  if (!item.actor) {
    return (
      <Flex
        flexShrink={0}
        boxSize={`${AVATAR_SIZE}px`}
        align="center"
        justify="center"
        borderRadius="full"
        bg={`app.${accent}.primary`}
        color={`app.${accent}.secondary`}
      >
        <Icon as={icon} boxSize="20px" />
      </Flex>
    )
  }

  return (
    <Box position="relative" flexShrink={0} boxSize={`${AVATAR_SIZE}px`}>
      <PersonAvatar user={item.actor} size={AVATAR_SIZE} />
      <Flex
        position="absolute"
        right="-3px"
        bottom="-3px"
        boxSize="20px"
        align="center"
        justify="center"
        borderRadius="full"
        borderWidth="2px"
        borderColor="bg.panel"
        bg={`app.${accent}.primary`}
        color={`app.${accent}.secondary`}
      >
        <Icon as={icon} boxSize="11px" />
      </Flex>
    </Box>
  )
}

interface NotificationRowProps {
  item: NotificationFeedItem
  isNew: boolean
  onNavigate: () => void
  /** A screening opened in the page's side panel instead of navigating. */
  onOpenedInPanel: () => void
  onDismiss: (item: NotificationFeedItem) => void
  onAccept: (item: NotificationFeedItem) => void
  onDecline: (item: NotificationFeedItem) => void
}

const NotificationRow = ({
  item,
  isNew,
  onNavigate,
  onOpenedInPanel,
  onDismiss,
  onAccept,
  onDecline,
}: NotificationRowProps) => {
  const copy = getNotificationCopy(item)
  const target = rowTarget(item)
  const isFriendRequest = item.type === "friend_request_received"
  const time = formatNotificationTime(item.created_at)

  const handleLinkClick = (event: MouseEvent) => {
    const isPlainClick =
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    if (isPlainClick && item.showtime && openInShowtimePanel(item.showtime)) {
      event.preventDefault()
      onOpenedInPanel()
      return
    }
    onNavigate()
  }

  return (
    <Flex
      className="group"
      position="relative"
      align="flex-start"
      gap={3}
      px={3}
      py={2.5}
      mx={1.5}
      borderRadius="10px"
      transition="background 120ms ease"
      _hover={target ? { bg: "bg.subtle" } : undefined}
      _focusWithin={{ bg: "bg.subtle" }}
    >
      {target ? (
        <RouterLink
          {...target}
          aria-label={copy.title}
          onClick={handleLinkClick}
          style={{ position: "absolute", inset: 0, borderRadius: "10px" }}
        />
      ) : null}

      <Leading item={item} />

      <Box flex="1" minW={0} pt="1px">
        <Text
          fontSize="13.5px"
          lineHeight="1.35"
          fontWeight={isNew ? "600" : "500"}
          color="fg"
          lineClamp={2}
        >
          {copy.title}
        </Text>
        {copy.subtitle ? (
          <Text
            fontSize="12px"
            lineHeight="1.4"
            color="fg.muted"
            mt="2px"
            truncate
          >
            {copy.subtitle}
          </Text>
        ) : null}

        {isFriendRequest && item.actor ? (
          // Above the stretched link, so the buttons get the click.
          <Flex gap={2} mt={2} position="relative" zIndex={1}>
            <Button
              size="xs"
              h="28px"
              px={3.5}
              borderRadius="full"
              bg="app.green.primary"
              color="app.green.secondary"
              borderWidth="1px"
              borderColor="app.green.border"
              fontWeight="700"
              _hover={{ filter: "brightness(0.97)" }}
              onClick={() => onAccept(item)}
            >
              <Icon as={MdHowToReg} boxSize="15px" />
              <Box as="span" position="relative" top="1px">
                Accept
              </Box>
            </Button>
            <Button
              size="xs"
              h="28px"
              px={3.5}
              borderRadius="full"
              variant="outline"
              borderColor="border"
              color="fg.muted"
              fontWeight="700"
              _hover={{ bg: "bg.subtle", color: "fg" }}
              onClick={() => onDecline(item)}
            >
              Decline
            </Button>
          </Flex>
        ) : null}
      </Box>

      {/* Time and the unseen dot; the dismiss button takes their place on
          hover, so the row keeps one quiet column instead of three. */}
      <Flex
        flexShrink={0}
        direction="column"
        align="flex-end"
        gap={1.5}
        minW="32px"
        pt="2px"
        position="relative"
      >
        <Text
          fontSize="11.5px"
          lineHeight="1.3"
          color={isNew ? "app.tint" : "fg.subtle"}
          fontWeight={isNew ? "600" : "500"}
          fontVariantNumeric="tabular-nums"
          transition="opacity 120ms ease"
          _groupHover={isFriendRequest ? undefined : { opacity: 0 }}
          _groupFocusWithin={isFriendRequest ? undefined : { opacity: 0 }}
        >
          {time}
        </Text>
        {isNew ? (
          <Box
            boxSize="8px"
            borderRadius="full"
            bg="app.tint"
            aria-label="New"
          />
        ) : null}

        {/* A friend request is resolved by answering it, so it has no
            dismiss; notifications and invites can both be cleared. */}
        {isFriendRequest ? null : (
          <Flex
            as="button"
            aria-label="Dismiss notification"
            position="absolute"
            top="-4px"
            right="-6px"
            zIndex={1}
            boxSize="26px"
            align="center"
            justify="center"
            borderRadius="full"
            color="fg.muted"
            cursor="pointer"
            opacity={0}
            transition="opacity 120ms ease, background 120ms ease"
            _groupHover={{ opacity: 1 }}
            _groupFocusWithin={{ opacity: 1 }}
            _focusVisible={{
              opacity: 1,
              outline: "2px solid",
              outlineColor: "app.tint",
            }}
            _hover={{ bg: "bg.muted", color: "fg" }}
            onClick={() => onDismiss(item)}
          >
            <Icon as={MdClose} boxSize="16px" />
          </Flex>
        )}
      </Flex>
    </Flex>
  )
}

export default NotificationRow
