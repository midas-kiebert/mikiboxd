/**
 * TanStack Router route module for . It connects URL state to the matching page component.
 */
import { Flex } from "@chakra-ui/react"
import { Outlet, createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"

import BottomNavBar from "@/components/Common/BottomNavBar"
// import Navbar from "@/components/Common/Navbar"
import Sidebar from "@/components/Common/Sidebar"
import { PAGE_NOTICE_BANNER_OFFSET_CSS_VAR } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"
import { Box } from "@chakra-ui/react"
import useTrackEvent from "shared/hooks/useTrackEvent"

import { primeSession } from "@/auth/session"

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
  const pageNoticeOffset = `var(${PAGE_NOTICE_BANNER_OFFSET_CSS_VAR}, 0px)`
  const { trackEvent } = useTrackEvent()

  const height = isMobile ? "calc(100% - 60px)" : "100%"

  useEffect(() => {
    // One mount per page load, signed in or not — a guest opening the site is
    // as much an open as a member is.
    trackEvent("app_open")
  }, [trackEvent])

  // Render/output using the state and derived values prepared above.
  return (
    <Flex
      direction="column"
      height={`calc(100vh - ${pageNoticeOffset})`}
      mt={pageNoticeOffset}
    >
      {/* <Navbar /> */}
      <Flex flex="1">
        {isMobile ? <BottomNavBar /> : <Sidebar />}
        <Box
          flex="1"
          px={2}
          height={height}
          mb={isMobile ? "60px" : "0px"}
          overflowY={"auto"}
        >
          <Outlet />
        </Box>
      </Flex>
    </Flex>
  )
}

export default Layout
