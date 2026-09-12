/**
 * TanStack Router route module for . It connects URL state to the matching page component.
 */
import { Flex } from "@chakra-ui/react"
import { Outlet, createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"

import BottomNavBar from "@/components/Common/BottomNavBar"
import TopNavBar from "@/components/Common/TopNavBar"
import { PAGE_NOTICE_BANNER_OFFSET_CSS } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"
import { Box } from "@chakra-ui/react"
import useTrackEvent from "shared/hooks/useTrackEvent"

import { primeSession } from "@/auth/session"

/** The fixed bottom nav on a phone, which the scrolling content has to clear. */
const BOTTOM_NAV_HEIGHT = 60

export const Route = createFileRoute("/_layout")({
  component: Layout,
  // Resolve the session before the first child renders, but never redirect on
  // it: the feed and the film pages are open to guests, and the five pages that
  // do need an account gate themselves with `RequireAccount`. Priming here is
  // what lets `useIsSignedIn()` answer synchronously everywhere below.
  beforeLoad: async () => {
    await primeSession()
  },
})

function Layout() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const isMobile = useIsMobile()
  const { trackEvent } = useTrackEvent()

  useEffect(() => {
    // One mount per page load, signed in or not — a guest opening the site is
    // as much an open as a member is.
    trackEvent("app_open")
  }, [trackEvent])

  // The nav is a row in this column rather than a fixed overlay, so the box
  // below it simply takes the height that is left. Nothing downstream clears
  // it — which is the point of the bar replacing the sidebar.
  return (
    <Flex
      direction="column"
      height={`calc(100vh - ${PAGE_NOTICE_BANNER_OFFSET_CSS})`}
      mt={PAGE_NOTICE_BANNER_OFFSET_CSS}
    >
      <TopNavBar />
      {isMobile ? <BottomNavBar /> : null}
      <Box
        flex="1"
        minH={0}
        px={isMobile ? 2 : 0}
        mb={isMobile ? `${BOTTOM_NAV_HEIGHT}px` : 0}
        overflowY="auto"
      >
        <Outlet />
      </Box>
    </Flex>
  )
}

export default Layout
