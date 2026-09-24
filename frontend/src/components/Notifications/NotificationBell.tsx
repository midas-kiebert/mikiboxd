/**
 * The bell in the top nav, and the notification panel that floats under it.
 *
 * The app keeps its notifications behind a bell rather than in its tab bar, and
 * now the website does too: the tabs are places, and this is not one.
 *
 * Open state lives in `notification-panel.ts` rather than here, so the feed
 * overview and the old `/pings` address can open the panel too.
 *
 * The panel keeps clear of the showtime panel docked at the right of a page,
 * because that is where a notification about a screening opens: it drops from
 * the bell and slides left as far as it must to end short of that column. For
 * the same reason, working in that column does not close it.
 */
import {
  Box,
  Flex,
  Icon,
  Popover,
  Portal,
  usePopoverContext,
} from "@chakra-ui/react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { FiBell } from "react-icons/fi"
import { MeService } from "shared/client"

import { formatBadgeCount } from "@/components/Common/nav-items"
import NotificationPanel from "@/components/Notifications/NotificationPanel"
import {
  setNotificationPanelOpen,
  useNotificationPanelOpen,
} from "@/components/Notifications/notification-panel"
import { TOP_NAV_HEIGHT } from "@/constants"
import { useNavBadgeCounts } from "@/hooks/useNavBadgeCounts"

const PANEL_WIDTH = 400
const PANEL_GUTTER = 10
/** Space kept between the panel and the showtime column it steers around. */
const SIDE_COLUMN_CLEARANCE = 16
/** The detail column animates its width open (`DETAIL_WIDTH_MS` in `FeedLayout`). */
const SIDE_COLUMN_SETTLE_MS = 260

/**
 * How far left the panel must slide from the bell's left edge to end short of
 * the page's right-hand column — any `[data-feed-side-panel]` in the right
 * half of the window. Zero on a page without one.
 */
const measureShift = (trigger: HTMLElement | null): number => {
  if (!trigger) return 0
  const columnLefts = [...document.querySelectorAll("[data-feed-side-panel]")]
    .map((column) => column.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.left > window.innerWidth / 2)
    .map((rect) => rect.left)
  if (!columnLefts.length) return 0
  const limit = Math.min(...columnLefts) - SIDE_COLUMN_CLEARANCE
  const width = Math.min(PANEL_WIDTH, window.innerWidth - 16)
  const overflow = trigger.getBoundingClientRect().left + width - limit
  return overflow > 0 ? -overflow : 0
}

/**
 * Moves the open panel when `shift` changes. The `positioning` prop is only
 * read as the panel opens; once it is up, only the popover's own
 * `reposition` moves it — which is what a screening opening beside it needs.
 */
const FollowShift = ({ shift }: { shift: number }) => {
  const { reposition } = usePopoverContext()
  useEffect(() => {
    reposition({ offset: { mainAxis: PANEL_GUTTER, crossAxis: shift } })
  }, [reposition, shift])
  return null
}

/** Pointer and focus moves into the showtime column leave the panel open. */
const isInSideColumn = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-feed-side-panel]") !== null

/** Tall enough for eight or so rows; never past the bottom of the window. */
const PANEL_MAX_HEIGHT = `min(600px, calc(100dvh - ${TOP_NAV_HEIGHT + 24}px))`

const NotificationBell = () => {
  const isOpen = useNotificationPanelOpen()
  const queryClient = useQueryClient()
  const { notifications: unseenCount } = useNavBadgeCounts()
  // Typed as a div because that is what `Flex` forwards; it renders a button.
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const [shift, setShift] = useState(0)

  const reposition = useCallback(
    () => setShift(measureShift(triggerRef.current)),
    [],
  )

  // Measured before the panel paints, so it never appears over the column and
  // then jumps; and again on resize, which moves the column.
  useLayoutEffect(() => {
    if (isOpen) reposition()
  }, [isOpen, reposition])
  useEffect(() => {
    if (!isOpen) return
    window.addEventListener("resize", reposition)
    return () => window.removeEventListener("resize", reposition)
  }, [isOpen, reposition])

  /**
   * A notification opened its screening beside the panel. The film page has
   * no column until something is selected, and the feeds' column animates its
   * width, so measure once it has had a frame and again once it has settled.
   */
  const handleOpenedInPanel = useCallback(() => {
    requestAnimationFrame(reposition)
    setTimeout(reposition, SIDE_COLUMN_SETTLE_MS)
  }, [reposition])

  /**
   * The list is only fetched while the panel is open, so fetch it the moment a
   * pointer heads for the bell: by the click it is usually in, and the panel
   * opens on rows instead of on skeletons.
   */
  const prefetch = () => {
    const params = { limit: 50, offset: 0 }
    queryClient.prefetchQuery({
      queryKey: ["me", "notifications", params],
      queryFn: () => MeService.getMyNotifications(params),
      staleTime: 30_000,
    })
  }

  const label =
    unseenCount > 0
      ? `Notifications, ${formatBadgeCount(unseenCount)} unread`
      : "Notifications"

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(event) => setNotificationPanelOpen(event.open)}
      lazyMount
      unmountOnExit
      positioning={{
        placement: "bottom-start",
        strategy: "fixed",
        offset: { mainAxis: PANEL_GUTTER, crossAxis: shift },
      }}
      onInteractOutside={(event) => {
        if (isInSideColumn(event.detail.target)) event.preventDefault()
      }}
    >
      <Popover.Trigger asChild>
        <Flex
          as="button"
          ref={triggerRef}
          // Pages that close their own panel on an outside press skip the
          // bell and the panel both (see the attribute on the content).
          data-notification-centre=""
          aria-label={label}
          title="Notifications"
          position="relative"
          flexShrink={0}
          boxSize="40px"
          align="center"
          justify="center"
          borderRadius="lg"
          cursor="pointer"
          color={isOpen ? "fg" : "fg.muted"}
          bg={isOpen ? "bg.subtle" : "transparent"}
          transition="background 120ms ease, color 120ms ease"
          _hover={{ bg: "bg.subtle", color: "fg" }}
          _focusVisible={{ outline: "2px solid", outlineColor: "app.tint" }}
          onPointerEnter={prefetch}
          onFocus={prefetch}
        >
          <Icon as={FiBell} boxSize="20px" />
          {unseenCount > 0 ? (
            <Box
              position="absolute"
              top="4px"
              right="3px"
              minW="18px"
              h="18px"
              px="5px"
              borderRadius="full"
              borderWidth="2px"
              borderColor="bg.panel"
              bg="app.notificationBadge"
              color="white"
              fontSize="10px"
              fontWeight="bold"
              lineHeight="14px"
              textAlign="center"
              boxSizing="border-box"
            >
              {formatBadgeCount(unseenCount)}
            </Box>
          ) : null}
        </Flex>
      </Popover.Trigger>

      <Portal>
        <Popover.Positioner>
          <Popover.Content
            data-notification-centre=""
            // Chakra's default scales the panel up out of the bell's corner,
            // which on a panel this size — and one that may have slid left of
            // the bell — reads as a swoop. A short fade and a 4px drop instead.
            _open={{
              animationName: "slide-from-top, fade-in",
              animationDuration: "160ms",
              animationTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            }}
            _closed={{
              animationName: "fade-out",
              animationDuration: "100ms",
              animationTimingFunction: "ease-in",
            }}
            css={{ "--slide-from-top-distance": "4px" }}
            w={`${PANEL_WIDTH}px`}
            maxW="calc(100vw - 16px)"
            maxH={PANEL_MAX_HEIGHT}
            p={0}
            display="flex"
            flexDirection="column"
            overflow="hidden"
            borderRadius="14px"
            borderWidth="1px"
            borderColor="border"
            bg="bg.panel"
            boxShadow="0 16px 40px rgb(0 0 0 / 0.14), 0 2px 8px rgb(0 0 0 / 0.06)"
          >
            <FollowShift shift={shift} />
            <NotificationPanel onOpenedInPanel={handleOpenedInPanel} />
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  )
}

export default NotificationBell
