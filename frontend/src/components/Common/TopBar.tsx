import {
  PAGE_NOTICE_BANNER_OFFSET_CSS,
  TOPBAR_HEIGHT,
  TOP_NAV_HEIGHT,
} from "@/constants"
/**
 * Shared web layout/presentation component: Top Bar.
 *
 * The secondary bar a page can fix under the navigation — the film page's day
 * filters, the friends page's search. It spans the full width now that the
 * sidebar is gone; all it still has to clear is the notice banner and the nav
 * itself, both of which are above it and neither of which changes width.
 */
import { Box } from "@chakra-ui/react"
import type { ReactNode } from "react"

interface Props {
  children?: ReactNode | null
}

const TopBar = ({ children }: Props) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <Box
      position="fixed"
      height={`${TOPBAR_HEIGHT}px`}
      top={`calc(${PAGE_NOTICE_BANNER_OFFSET_CSS} + ${TOP_NAV_HEIGHT}px)`}
      left="0"
      right="0"
      zIndex={1200}
      bg="bg.panel"
      borderBottomWidth="1px"
      borderColor="border"
      px={4}
      py={2}
      display="flex"
      gap={4}
    >
      {children}
    </Box>
  )
}

export default TopBar
