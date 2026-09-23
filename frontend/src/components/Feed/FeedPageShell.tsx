import { Box, Button, Center, Flex, Spinner, Text } from "@chakra-ui/react"
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
 *
 * The paging spinner sits in a footer that always keeps its height, the way
 * the app's `LoadMoreFooter` does: only the spinner fades. Rendered only while
 * a page loaded, it grew the page by its own height and then took it back as
 * the rows arrived, and the rows themselves arrive a render after the query
 * does (`ShowtimeFeedPage` draws them from a deferred copy) — so the page
 * shrank under the reader in between and jumped.
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
  /** Replace every filter the page does not pin — see `useFeedParams`. */
  applyParams: (params: FeedParams) => void
  activeFilterCount: number
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  isEmpty: boolean
  isFilteredEmpty: boolean
  /** The rows on screen belong to filters no longer in force; see `useFeedParams`. */
  isReplacingRows: boolean
}

/** The footer's reserved height: a small spinner plus its padding. */
const FOOTER_HEIGHT = "56px"
/** Appearing keeps up with reaching the end; fading reads as the page settling. */
const SPINNER_SHOW_MS = 160
const SPINNER_HIDE_MS = 260

type FeedPageShellProps = {
  feed: FeedChrome
  children: ReactNode
  /** Sits above the toolbar — a cinema's name, whose agenda this is. */
  header?: ReactNode
  /** Opens next to the list, when something is selected. */
  detail?: ReactNode
  emptyText?: string
  filteredEmptyText?: string
  /** Replaces the empty message and its "Clear filters" outright. */
  emptyState?: ReactNode
  hasNav?: boolean
  showRail?: boolean
  showPresets?: boolean
  showGroupToggle?: boolean
  searchPlaceholder?: string
  /** The sentinel the page's infinite scroll observes. */
  loadMoreRef?: React.RefObject<HTMLDivElement | null>
  /** Passed to `FeedLayout`: the rows are a grid of cards. */
  grid?: boolean
  /** Passed to `FeedLayout`: below it, the rail folds to its strip. */
  minListWidth?: number
  /** Passed to `FeedLayout`: under the rail card, in the same column. */
  railFooter?: (variant: "full" | "compact") => ReactNode
  /** Passed to `FeedLayout`: a full-width feed with no detail column. */
  fillWidth?: boolean
  /**
   * Whether the paging spinner shows, where that is more than the query's
   * own `isFetchingNextPage` — rows still being drawn, say.
   */
  isLoadingMore?: boolean
  /**
   * Whether the loading screen stands in for the rows. The page decides:
   * only it knows whether the rows it holds are still worth showing — a
   * search narrowing keeps them, a filter change does not.
   */
  isLoadingRows?: boolean
}

const FeedPageShell = ({
  feed,
  children,
  header,
  detail,
  emptyText = "Nothing showing.",
  filteredEmptyText = "Nothing matches these filters.",
  emptyState,
  hasNav = true,
  showRail = true,
  showPresets = true,
  showGroupToggle = false,
  searchPlaceholder,
  loadMoreRef,
  grid = false,
  minListWidth,
  railFooter,
  fillWidth = false,
  isLoadingMore = feed.isFetchingNextPage,
  isLoadingRows = feed.isLoading || feed.isReplacingRows,
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
    [
      searchInNav,
      feed.params.q,
      feed.params.field,
      feed.setParams,
      searchPlaceholder,
    ],
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
      grid={grid}
      fillWidth={fillWidth}
      minListWidth={minListWidth}
      activeFilterCount={feed.activeFilterCount}
      railFooter={showRail ? railFooter : undefined}
    >
      {isLoadingRows ? (
        <Center py={20}>
          <Spinner size="xl" />
        </Center>
      ) : null}

      {feed.isEmpty && !isLoadingRows && emptyState ? emptyState : null}

      {feed.isEmpty && !isLoadingRows && !emptyState ? (
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
      {isLoadingRows || feed.isEmpty ? null : (
        <Center
          h={FOOTER_HEIGHT}
          pointerEvents="none"
          aria-hidden={!isLoadingMore}
        >
          <Box
            display="flex"
            opacity={isLoadingMore ? 1 : 0}
            transition={`opacity ${isLoadingMore ? SPINNER_SHOW_MS : SPINNER_HIDE_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`}
          >
            <Spinner size="sm" />
          </Box>
        </Center>
      )}
    </FeedLayout>
  )
}

export default FeedPageShell
