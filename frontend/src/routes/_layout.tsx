import { Flex } from "@chakra-ui/react"
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

import Navbar from "@/components/Common/Navbar"
import Sidebar from "@/components/Common/Sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import { Box } from "@chakra-ui/react"
import { useIsMobile } from "@/hooks/useIsMobile"
import BottomNavBar from "@/components/Common/BottomNavBar"

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
  const isMobile = useIsMobile();

  return (
    <Flex direction="column" height="100vh">
      <Navbar />
      <Flex flex="1">
        {isMobile
          ? <BottomNavBar />
          : <Sidebar />
        }
        <Box
          flex="1"
          bg="white"
          p={4}
          height="calc(100vh - 85px)"
        >
          <Outlet />
        </Box>
      </Flex>
    </Flex>
  )
}

export default Layout
