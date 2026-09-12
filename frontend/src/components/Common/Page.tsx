import { PAGE_NOTICE_BANNER_OFFSET_CSS, TOPBAR_HEIGHT } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"
/**
 * Shared web layout/presentation component: Page.
 *
 * Clears the one piece of chrome that is still fixed: the secondary `TopBar`
 * some pages put under the navigation. The nav itself is in the document flow,
 * so there is nothing to clear on that side — a page starts where its parent
 * ends.
 */
import { Box } from "@chakra-ui/react"
import type { ReactNode } from "react"

interface Props {
  children: ReactNode
  topbarHeight?: number
}

const Page = ({ children, topbarHeight = TOPBAR_HEIGHT }: Props) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isMobile = useIsMobile()

  // A phone gets a shorter top bar.
  const height = isMobile ? 50 : topbarHeight

  // Render/output using the state and derived values prepared above.
  return (
    <Box
      mt={`${height}px`}
      p={isMobile ? 0 : 4}
      minH={`calc(100vh - ${PAGE_NOTICE_BANNER_OFFSET_CSS} - ${height}px - 1rem)`}
      overflowX="hidden"
    >
      {children}
    </Box>
  )
}

export default Page
