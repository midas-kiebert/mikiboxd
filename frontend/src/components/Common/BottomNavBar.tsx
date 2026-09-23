/**
 * Shared web layout/presentation component: Bottom Nav Bar.
 *
 * The narrow-screen rendering of the app's tab bar, off the same `nav-items.ts`
 * the top bar uses. It was six bare icons in an order of its own; it is now the
 * app's tabs, labelled and badged the way the app labels and badges them.
 *
 * The tabs live down here on a phone because that is where the app keeps them,
 * which is why `TopNavBar` drops its own row of them below `md`.
 */
import { Box, Flex, Grid, Icon, Text, useToken } from "@chakra-ui/react"
import { Link as RouterLink } from "@tanstack/react-router"

import {
  NAV_ICON_SIZE,
  NAV_ITEMS,
  formatBadgeCount,
} from "@/components/Common/nav-items"
import { useNavBadgeCounts } from "@/hooks/useNavBadgeCounts"

const BottomNavBar = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  // Data hooks keep this module synced with backend data and shared cache state.
  const badgeCounts = useNavBadgeCounts()
  const [activeColor] = useToken("colors", "app.tabIconSelected")

  const items = NAV_ITEMS
  const listItems = items.map(({ icon, title, path, badge }) => {
    const count = badge ? badgeCounts[badge] : 0

    return (
      <RouterLink
        key={title}
        from="/"
        search={true}
        to={path}
        // Showtimes is "/", which prefix-matches every other route, so only it
        // needs the exact test.
        activeOptions={{ exact: path === "/" }}
        activeProps={{ style: { color: activeColor } }}
        style={{ width: "100%", height: "100%" }}
      >
        <Flex
          width="100%"
          height="100%"
          direction="column"
          justifyContent="center"
          alignItems="center"
          gap={0.5}
        >
          {/* The badge hangs off the icon, not the cell, so it sits on the
              icon's corner the way the app's does. */}
          <Box position="relative">
            <Icon as={icon} boxSize={NAV_ICON_SIZE} />
            {count > 0 ? (
              <Box
                position="absolute"
                top="-5px"
                right="-8px"
                minW="18px"
                h="18px"
                px="5px"
                bg="app.notificationBadge"
                color="white"
                borderRadius="full"
                fontSize="10px"
                fontWeight="bold"
                lineHeight="18px"
                textAlign="center"
              >
                {formatBadgeCount(count)}
              </Box>
            ) : null}
          </Box>
          <Text fontSize="10px" lineHeight="1.2">
            {title}
          </Text>
        </Flex>
      </RouterLink>
    )
  })

  // Render/output using the state and derived values prepared above.
  return (
    <Box
      position="fixed"
      bg="bg.subtle"
      bottom={0}
      zIndex={10}
      width={"100%"}
      h="60px"
      px={2}
    >
      <Grid
        templateColumns={`repeat(${items.length}, 1fr)`}
        height="100%"
        alignItems="center"
      >
        {listItems}
      </Grid>
    </Box>
  )
}

export default BottomNavBar
