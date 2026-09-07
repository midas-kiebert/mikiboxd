/**
 * The chrome every feed page shares: layout, toolbar, rail, presets, and the
 * loading / empty / paging states.
 *
 * Rows are the caller's business — showtimes render one thing and films another
 * — so this takes them as children and owns nothing about them. Extracted when
 * the films feed and the showtimes feed turned out to differ only in their rows,
 * which is also what makes group-by-film possible: the same page can swap which
 * feed it is showing without swapping anything around it.
 */
import type { ReactNode } from "react"
import { Button, Center, Flex, Spinner, Text } from "@chakra-ui/react"

import FeedFilterRail from "@/components/Feed/FeedFilterRail"
import FeedLayout from "@/components/Feed/FeedLayout"
import FeedPresets from "@/components/Feed/FeedPresets"
import FeedToolbar from "@/components/Feed/FeedToolbar"
import type { FeedParams } from "@/features/showtimes/feed-params"

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
  /** How many rows are showing, for the toolbar's count. */
  resultCount: number
  children: ReactNode
  /** Sits above the toolbar — a cinema's name, whose agenda this is. */
  header?: ReactNode
  /** Opens next to the list, when something is selected. */
  detail?: ReactNode
  emptyText?: string
  filteredEmptyText?: string
  hasSidebar?: boolean
  showRail?: boolean
  showPresets?: boolean
  showGroupToggle?: boolean
  searchPlaceholder?: string
  resultNoun?: string
  /** The sentinel the page's infinite scroll observes. */
  loadMoreRef?: React.RefObject<HTMLDivElement | null>
}

const FeedPageShell = ({
  feed,
  resultCount,
  children,
  header,
  detail,
  emptyText = "Nothing showing.",
  filteredEmptyText = "Nothing matches these filters.",
  hasSidebar = true,
  showRail = true,
  showPresets = true,
  showGroupToggle = false,
  searchPlaceholder,
  resultNoun,
  loadMoreRef,
}: FeedPageShellProps) => {
  const toolbar = (
    <Flex direction="column" gap={2}>
      <FeedToolbar
        params={feed.params}
        onChange={feed.setParams}
        onReset={feed.resetParams}
        activeFilterCount={feed.activeFilterCount}
        resultCount={resultCount}
        showGroupToggle={showGroupToggle}
        searchPlaceholder={searchPlaceholder}
        resultNoun={resultNoun}
      />
      {showPresets ? (
        <FeedPresets params={feed.params} onChange={feed.setParams} />
      ) : null}
    </Flex>
  )

  return (
    <FeedLayout
      hasSidebar={hasSidebar}
      rail={
        showRail ? (
          <FeedFilterRail params={feed.params} onChange={feed.setParams} />
        ) : undefined
      }
      toolbar={
        header ? (
          <Flex direction="column" gap={2}>
            {header}
            {toolbar}
          </Flex>
        ) : (
          toolbar
        )
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
