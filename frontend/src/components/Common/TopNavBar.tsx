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
 * account chip do not fit across a phone. So this narrows to brand and account.
 */
import { Box, Flex } from "@chakra-ui/react"

import NavAccount from "@/components/Common/NavAccount"
import NavBrand from "@/components/Common/NavBrand"
import NavTabs from "@/components/Common/NavTabs"
import FeedSearchBar from "@/components/Feed/FeedSearchBar"
import { useFeedSearchSlot } from "@/components/Feed/feed-search-slot"
import { TOP_NAV_HEIGHT } from "@/constants"

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
const SEARCH_MAX_WIDTH = "560px"

const TopNavBar = () => {
  const search = useFeedSearchSlot()

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
        {/* Tabs are the bottom bar's job on a phone. */}
        <Box display={{ base: "none", md: "block" }} minW={0}>
          <NavTabs />
        </Box>

        {/*
          Always here, with or without a field in it: it is the bar's spacer as
          well as the search's seat, so the account chip does not slide left and
          right as you move between a feed page and Settings.
        */}
        <Flex flex="1" minW={0} justify="center" px={{ base: 0, lg: 2 }}>
          {search ? (
            <Box w="100%" maxW={SEARCH_MAX_WIDTH} minW={0}>
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

        <NavAccount />
      </Flex>
    </Box>
  )
}

export default TopNavBar
