/**
 * The app's tabs, laid out across the top bar.
 *
 * What the entries are, and in which order, is `nav-items.ts` — shared with the
 * mobile bottom bar so the two cannot drift apart again.
 *
 * A tab is icon + label + badge on one line. It was a vertical rail with a
 * collapse toggle, an edge marker and a tooltip for every label; laid
 * horizontally none of that has anything to do — there is no width to reclaim,
 * so there is no collapsed state, so the label is always there to name the tab.
 */
import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"

import type { MeGetCurrentUserResponse } from "shared"

import {
  NAV_ICON_SIZE,
  formatBadgeCount,
  getNavItems,
} from "@/components/Common/nav-items"
import { useNavBadgeCounts } from "@/hooks/useNavBadgeCounts"

/**
 * The lit pill behind the current route, and the ink on it.
 *
 * `secondary` rather than the app's `tabIconSelected` for the ink, because the
 * label sits *on* the green fill: the palette tunes each accent's `secondary`
 * to clear 4.9:1 on its own `primary`, and the raw tint does not — it is tuned
 * against white.
 */
const ACTIVE_BG = "app.green.primary"
const ACTIVE_FG = "app.green.secondary"

const NavTabs = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()
  const currentUser = queryClient.getQueryData<MeGetCurrentUserResponse>([
    "currentUser",
  ])
  // Data hooks keep this module synced with backend data and shared cache state.
  const badgeCounts = useNavBadgeCounts()

  const tabs = getNavItems(!!currentUser?.is_superuser).map(
    ({ icon, title, path, badge }) => {
      const count = badge ? badgeCounts[badge] : 0

      return (
        <RouterLink
          key={title}
          from="/"
          to={path}
          search={true}
          // Showtimes is "/", which prefix-matches every other route, so only
          // it needs the exact test; Admin has children that must stay lit.
          activeOptions={{ exact: path === "/" }}
          style={{ display: "block" }}
        >
          {({ isActive }) => (
            <Flex
              align="center"
              gap={2}
              h="40px"
              px={3}
              borderRadius="lg"
              fontSize="sm"
              fontWeight={isActive ? "semibold" : "medium"}
              whiteSpace="nowrap"
              bg={isActive ? ACTIVE_BG : "transparent"}
              color={isActive ? ACTIVE_FG : "fg.muted"}
              transition="background 120ms ease, color 120ms ease"
              _hover={isActive ? undefined : { bg: "bg.subtle", color: "fg" }}
            >
              <Icon as={icon} boxSize={NAV_ICON_SIZE} />
              {/* The label is hidden rather than dropped on a narrow desktop:
                  the icons keep their order and their badges, and the tab is
                  still named for a screen reader. */}
              <Text truncate display={{ base: "none", lg: "block" }}>
                {title}
              </Text>
              <Text srOnly display={{ base: "block", lg: "none" }}>
                {title}
              </Text>
              {count > 0 ? (
                <Box
                  minW="20px"
                  bg="app.notificationBadge"
                  color="white"
                  borderRadius="full"
                  px={1.5}
                  fontSize="10px"
                  fontWeight="bold"
                  lineHeight="18px"
                  textAlign="center"
                >
                  {formatBadgeCount(count)}
                </Box>
              ) : null}
            </Flex>
          )}
        </RouterLink>
      )
    },
  )

  // Render/output using the state and derived values prepared above.
  return (
    <Flex as="nav" aria-label="Main" align="center" gap={1} minW={0}>
      {tabs}
    </Flex>
  )
}

export default NavTabs
