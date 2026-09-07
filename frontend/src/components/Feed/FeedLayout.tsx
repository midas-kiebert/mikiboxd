/**
 * The three-column shell every feed screen sits in: filters on the left, the
 * list in the middle, a detail panel on the right.
 *
 * All of the geometry lives here, in the constants at the top and the one grid
 * below. Screens hand it slots and never position anything themselves, so
 * changing the layout — different widths, a different column order, the rail
 * moved to the right, the detail panel turned into an overlay — is an edit to
 * this file alone and no screen has to know it happened.
 *
 * The shape is the app's, spent differently: the app stacks a toolbar over a
 * list because a phone has one column, and hides filters behind a button and
 * the showtime panel behind a full-screen sheet for the same reason. Here the
 * filters stay open and the panel sits beside the list, so acting on one
 * showtime does not hide the others.
 */
import { Box, Flex } from "@chakra-ui/react"
import type { ReactNode } from "react"

import { SIDEBAR_WIDTH } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"

/** The fixed bottom nav on narrow screens, which content has to clear. */
const BOTTOM_NAV_HEIGHT = 60

/** Filter rail. Wide enough for a cinema name without wrapping. */
export const RAIL_WIDTH = 280
/** Detail panel. Wide enough for a poster beside its showtime list. */
export const DETAIL_WIDTH = 380
/** Keeps the list from becoming an unreadable ribbon on an ultrawide monitor. */
export const LIST_MAX_WIDTH = 900

type FeedLayoutProps = {
  /** Filter controls. Hidden on narrow screens until it becomes a drawer. */
  rail?: ReactNode
  /** Search and the controls that belong above the list. Sticks while scrolling. */
  toolbar?: ReactNode
  /** The feed itself. */
  children: ReactNode
  /** The selected showtime, when there is one. */
  detail?: ReactNode
  /**
   * False on the routes that sit outside `_layout` and so have no sidebar to
   * clear — the deep-link targets the app sends people to.
   */
  hasSidebar?: boolean
}

const FeedLayout = ({
  rail,
  toolbar,
  children,
  detail,
  hasSidebar = true,
}: FeedLayoutProps) => {
  const isMobile = useIsMobile()
  const showRail = Boolean(rail) && !isMobile
  const showDetail = Boolean(detail) && !isMobile

  return (
    // The sidebar is position:fixed and so takes no flow space — clearing it is
    // this component's job, along with the bottom nav that replaces it on a
    // phone. Screens never deal with either.
    <Flex
      align="stretch"
      gap={0}
      minH="100%"
      ml={isMobile || !hasSidebar ? 0 : `${SIDEBAR_WIDTH}px`}
      mb={isMobile && hasSidebar ? `${BOTTOM_NAV_HEIGHT}px` : 0}
    >
      {showRail ? (
        <Box
          as="aside"
          w={`${RAIL_WIDTH}px`}
          flexShrink={0}
          borderRightWidth="1px"
          borderColor="border"
          position="sticky"
          top={0}
          alignSelf="flex-start"
          maxH="100vh"
          overflowY="auto"
          p={3}
        >
          {rail}
        </Box>
      ) : null}

      <Box flex="1" minW={0}>
        {toolbar ? (
          <Box
            position="sticky"
            top={0}
            zIndex={5}
            bg="bg"
            borderBottomWidth="1px"
            borderColor="border"
            px={{ base: 2, md: 4 }}
            py={2}
          >
            {toolbar}
          </Box>
        ) : null}

        <Box
          maxW={`${LIST_MAX_WIDTH}px`}
          mx="auto"
          px={{ base: 0, md: 2 }}
          pb={16}
        >
          {children}
        </Box>
      </Box>

      {showDetail ? (
        <Box
          as="aside"
          w={`${DETAIL_WIDTH}px`}
          flexShrink={0}
          borderLeftWidth="1px"
          borderColor="border"
          position="sticky"
          top={0}
          alignSelf="flex-start"
          maxH="100vh"
          overflowY="auto"
          p={3}
        >
          {detail}
        </Box>
      ) : null}
    </Flex>
  )
}

export default FeedLayout
