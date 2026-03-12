/**
 * TanStack Router route module for . It connects URL state to the matching page component.
 */
import { Flex } from "@chakra-ui/react"
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

import BottomNavBar from "@/components/Common/BottomNavBar"
// import Navbar from "@/components/Common/Navbar"
import Sidebar from "@/components/Common/Sidebar"
import { useIsMobile } from "@/hooks/useIsMobile"
import BottomNavBar from "@/components/Common/BottomNavBar"
import { PAGE_NOTICE_BANNER_OFFSET_CSS_VAR } from "@/constants"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
})

function Layout() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const isMobile = useIsMobile();
  const pageNoticeOffset = `var(${PAGE_NOTICE_BANNER_OFFSET_CSS_VAR}, 0px)`

  const height = isMobile ? "calc(100% - 60px)" : "100%"

  // Render/output using the state and derived values prepared above.
  return (
    <Flex direction="column" height={`calc(100vh - ${pageNoticeOffset})`} mt={pageNoticeOffset}>
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
