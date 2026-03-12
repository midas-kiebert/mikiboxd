import { SIDEBAR_WIDTH } from "@/constants"
import { TOPBAR_HEIGHT } from "@/constants"
/**
 * Shared web layout/presentation component: Top Bar.
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
      top="0"
      flex={"1"}
      left={{ base: "0", md: SIDEBAR_WIDTH }}
      right="0"
      zIndex="sticky"
      bg="gray.50"
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
