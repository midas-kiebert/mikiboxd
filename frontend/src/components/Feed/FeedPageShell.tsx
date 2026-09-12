import { Button, Center, Flex, Spinner, Text } from "@chakra-ui/react"
/**
 * The chrome every feed page shares: layout, toolbar, rail, presets, and the
 * loading / empty / paging states.
 *
 * Rows are the caller's business — showtimes render one thing and films another
 * — so this takes them as children and owns nothing about them. Extracted when
 * the films feed and the showtimes feed turned out to differ only in their rows,
 * which is also what makes group-by-film possible: the same page can swap which
 * feed it is showing without swapping anything around it.
 *
 * It also decides where the feed's two page-level controls live, which is a
 * question about the window rather than about the feed:
 *
 *   - The **search field** goes into the site's navigation, which has a wide
 *     empty middle and is already on screen. It falls back to a bar above the
 *     list only where there is no nav to put it in (the deep-link routes
 *     outside `_layout`) or no room (a phone).
 *   - **Clear filters** goes into the filter rail, beside the filters it
 *     clears, and falls back to that same bar on a phone, where there is no
 *     rail.
 *
 * On the home feed and the films feed both of those land elsewhere, so nothing
 * is rendered above the list at all — the two pages that most want the height
 * get a full band of it back.
 */
import { type ReactNode, useMemo } from "react"

import FeedFilterRail from "@/components/Feed/FeedFilterRail"
import FeedLayout from "@/components/Feed/FeedLayout"
import FeedToolbar from "@/components/Feed/FeedToolbar"
import { usePublishFeedSearch } from "@/components/Feed/feed-search-slot"
import type { FeedParams } from "@/features/showtimes/feed-params"
import { useIsMobile } from "@/hooks/useIsMobile"
import type { SearchField } from "shared/client"

/** The state every feed hook exposes, minus its rows. */
export type FeedChrome = {
  params: FeedParams
  setParams: (patch: Partial<FeedParams>) => void
  resetParams: () => void
  activeFilterCount: number
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  isEmpty: boolean
  isFilteredEmpty: boolean
}

type FeedPageShellProps = {
  feed: FeedChrome
  children: ReactNode
  /** Sits above the toolbar — a cinema's name, whose agenda this is. */
  header?: ReactNode
  /** Opens next to the list, when something is selected. */
  detail?: ReactNode
  emptyText?: string
  filteredEmptyText?: string
  hasNav?: boolean
  showRail?: boolean
  showPresets?: boolean
  showGroupToggle?: boolean
  searchPlaceholder?: string
  /** The sentinel the page's infinite scroll observes. */
  loadMoreRef?: React.RefObject<HTMLDivElement | null>
}

const FeedPageShell = ({
  feed,
  children,
  header,
  detail,
  emptyText = "Nothing showing.",
  filteredEmptyText = "Nothing matches these filters.",
  hasNav = true,
  showRail = true,
  showPresets = true,
  showGroupToggle = false,
  searchPlaceholder,
  loadMoreRef,
}: FeedPageShellProps) => {
  const isMobile = useIsMobile()

  // Where the search field goes. The navigation carries it wherever there is
  // one wide enough — which is every route inside `_layout`, on anything
  // bigger than a phone. The two exceptions fall back to a bar above the list.
  const searchInNav = hasNav && !isMobile
  // And where the reset goes: beside the filters it resets, which is the rail
  // whenever the rail is on screen. `FeedLayout` drops the rail on a phone.
  const resetInRail = showRail && !isMobile

  // Memoised because it is the publisher's effect dependency: a fresh object
  // every render would republish the slot on every render.
  const navSearch = useMemo(
    () =>
      searchInNav
        ? {
            query: feed.params.q,
            field: feed.params.field,
            onQueryChange: (q: string) => feed.setParams({ q }),
            onFieldChange: (field: SearchField) => feed.setParams({ field }),
            placeholder: searchPlaceholder,
          }
        : null,
    [searchInNav, feed.params.q, feed.params.field, feed.setParams, searchPlaceholder],
  )
  usePublishFeedSearch(navSearch)

  // Nothing is rendered above the list at all when the nav has the field and
  // the page has no title of its own — which is the home feed and the films
  // feed, the two that most want the vertical space.
  const toolbar = searchInNav ? null : (
    <FeedToolbar
      params={feed.params}
      onChange={feed.setParams}
      searchPlaceholder={searchPlaceholder}
      onReset={resetInRail ? undefined : feed.resetParams}
      activeFilterCount={feed.activeFilterCount}
    />
  )

  return (
    <FeedLayout
      hasNav={hasNav}
      rail={
        showRail ? (
          <FeedFilterRail
            params={feed.params}
            onChange={feed.setParams}
            onReset={resetInRail ? feed.resetParams : undefined}
            activeFilterCount={feed.activeFilterCount}
            showPresets={showPresets}
            showGroupToggle={showGroupToggle}
          />
        ) : undefined
      }
      toolbar={
        header || toolbar ? (
          <Flex direction="column" gap={2}>
            {header}
            {toolbar}
          </Flex>
        ) : undefined
      }
      detail={detail}
    >
      {feed.isLoading ? (
        <Center py={20}>
          <Spinner size="xl" />
        </Center>
      ) : null}

      {feed.isEmpty ? (
        <Center py={20}>
          <Flex direction="column" align="center" gap={3}>
            <Text color="fg.muted">
              {feed.isFilteredEmpty ? filteredEmptyText : emptyText}
            </Text>
            {feed.isFilteredEmpty ? (
              <Button size="sm" variant="surface" onClick={feed.resetParams}>
                Clear filters
              </Button>
            ) : null}
          </Flex>
        </Center>
      ) : null}

      {children}

      {feed.hasNextPage && loadMoreRef ? (
        <div ref={loadMoreRef} style={{ height: "1px" }} />
      ) : null}
      {feed.isFetchingNextPage ? (
        <Center py={6}>
          <Spinner size="sm" />
        </Center>
      ) : null}
    </FeedLayout>
  )
}

export default FeedPageShell
