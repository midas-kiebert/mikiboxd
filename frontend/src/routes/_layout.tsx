/**
 * TanStack Router route module for . It connects URL state to the matching page component.
 */
import { Flex } from "@chakra-ui/react"
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect } from "react"

import BottomNavBar from "@/components/Common/BottomNavBar"
// import Navbar from "@/components/Common/Navbar"
import Sidebar from "@/components/Common/Sidebar"
import { PAGE_NOTICE_BANNER_OFFSET_CSS_VAR } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"
import { Box } from "@chakra-ui/react"
import { isLoggedIn } from "shared/hooks/useAuth"
import useTrackEvent from "shared/hooks/useTrackEvent"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!(await isLoggedIn())) {
      throw redirect({
        to: "/login",
      })
    }
  },
})

function Layout() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const isMobile = useIsMobile()
  const pageNoticeOffset = `var(${PAGE_NOTICE_BANNER_OFFSET_CSS_VAR}, 0px)`
  const { trackEvent } = useTrackEvent()

  const height = isMobile ? "calc(100% - 60px)" : "100%"

  useEffect(() => {
    // beforeLoad already guarantees a session exists by the time this layout
    // mounts, so a mount here is a genuine website open (one per page load).
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
