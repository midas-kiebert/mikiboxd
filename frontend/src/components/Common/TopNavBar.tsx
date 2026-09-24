/**
 * The site's primary navigation: brand, tabs, search, account, across the top.
 *
 * This replaced a fixed left sidebar. The rail cost 264px of every screen and,
 * worse, had to be *cleared* by every layout beside it — which is what put the
 * feed behind four stacked columns: sidebar, filter rail, list, detail panel.
 * A bar in the document flow is cleared by nobody: it takes its height off the
 * top and everything below simply starts lower.
 *
 * The search field sits here rather than in a bar of its own above the feed.
 * It was the only thing in that bar, and a full-width band spent on one control
 * is a band the list does not get — while the nav had a wide empty middle doing
 * nothing. Which page is being searched is not this file's business: a feed
 * page fills `feed-search-slot` while it is mounted and this renders whatever
 * is in it, so the field is absent on Friends and Settings without anybody
 * keeping a list of which routes have a feed.
 *
 * On a phone the tabs move to `BottomNavBar`, which is where the app keeps
 * them, and the search goes back above the feed — a brand, a field and an
 * account chip do not fit across a phone. So this narrows to brand, bell and
 * account.
 */
import { Box, Flex } from "@chakra-ui/react"
import { type RefObject, useLayoutEffect, useRef, useState } from "react"

import { useIsSignedIn } from "@/auth/useSession"
import NavAccount from "@/components/Common/NavAccount"
import NavBrand from "@/components/Common/NavBrand"
import NavTabs from "@/components/Common/NavTabs"
import FeedSearchBar from "@/components/Feed/FeedSearchBar"
import {
  useFeedListCenter,
  useFeedSearchSlot,
} from "@/components/Feed/feed-search-slot"
import NotificationBell from "@/components/Notifications/NotificationBell"
import { TOP_NAV_HEIGHT } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"

/**
 * Above the feed's pinned rail and detail panel, and above the fixed secondary
 * `TopBar` some pages put under it, so neither paints over the navigation.
 */
const TOP_NAV_Z_INDEX = 1300

/**
 * Wide enough for a film title and the scope chip beside it, and capped so the
 * field does not stretch across an ultrawide monitor — the same reasoning as
 * the feed's own `LIST_MAX_WIDTH`.
 */
const SEARCH_MAX_WIDTH = 560

/**
 * How far into its seat the field starts, so that it sits centred over the
 * feed's list — the ticket wall or the film rows — rather than in the middle of
 * the bar. Where the seat is too narrow for that it slides as far towards the
 * list as it can, which in practice is hard against the tabs on the left.
 * `0` (flush left) until both are measured.
 */
const useSearchOffset = (
  seatRef: RefObject<HTMLDivElement | null>,
  listCenter: number | null,
  enabled: boolean,
): number => {
  const [seat, setSeat] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const element = seatRef.current
    if (!element || !enabled) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setSeat({ left: rect.left, width: element.clientWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [seatRef, enabled])

  if (!seat || listCenter === null) return 0
  const width = Math.min(SEARCH_MAX_WIDTH, seat.width)
  const wanted = listCenter - seat.left - width / 2
  return Math.max(0, Math.min(wanted, seat.width - width))
}

const TopNavBar = () => {
  const search = useFeedSearchSlot()
  const isSignedIn = useIsSignedIn()
  const isMobile = useIsMobile()
  const listCenter = useFeedListCenter()
  const seatRef = useRef<HTMLDivElement>(null)
  const searchOffset = useSearchOffset(seatRef, listCenter, search !== null)

  return (
    <Box
      as="header"
      flexShrink={0}
      h={`${TOP_NAV_HEIGHT}px`}
      zIndex={TOP_NAV_Z_INDEX}
      bg="bg.panel"
      borderBottomWidth="1px"
      borderColor="border"
      px={{ base: 3, md: 4 }}
    >
      <Flex align="center" h="100%" gap={{ base: 2, md: 6 }}>
        <NavBrand />
        {/* Tabs are the bottom bar's job on a phone. The bell closes the row
            on a desktop, set off by a hairline: nav-adjacent, but not a tab —
            it opens a panel over the page rather than going anywhere. Out
            here at the left its panel also has room to drop without covering
            the showtime panel at the right. A guest has no notifications. */}
        {isMobile ? null : (
          <Flex align="center" gap={2} minW={0}>
            <NavTabs />
            {isSignedIn ? (
              <>
                <Box w="1px" h="24px" bg="border" flexShrink={0} aria-hidden />
                <NotificationBell />
              </>
            ) : null}
          </Flex>
        )}

        {/*
          Always here, with or without a field in it: it is the bar's spacer as
          well as the search's seat, so the account chip does not slide left and
          right as you move between a feed page and Settings.
        */}
        <Flex ref={seatRef} flex="1" minW={0} justify="flex-start">
          {search ? (
            <Box
              w="100%"
              maxW={`${SEARCH_MAX_WIDTH}px`}
              minW={0}
              ml={`${searchOffset}px`}
            >
              <FeedSearchBar
                query={search.query}
                onQueryChange={search.onQueryChange}
                field={search.field}
                onFieldChange={search.onFieldChange}
                placeholder={search.placeholder}
              />
            </Box>
          ) : null}
        </Flex>

        {/* On a phone the bell sits with the account instead. */}
        {isMobile && isSignedIn ? <NotificationBell /> : null}
        <NavAccount />
      </Flex>
    </Box>
  )
}

export default TopNavBar
