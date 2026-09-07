import { Box, Button, Center, Flex, Spinner, Text } from "@chakra-ui/react"
/**
 * Every showtime feed on the website, rendered once.
 *
 * The home feed, a cinema's programme, your agenda and a friend's agenda differ
 * only in where their rows come from and what they say when empty. They were
 * four near-identical pages; this is the one they share, so a change to how a
 * feed looks or behaves happens here rather than four times with three of them
 * forgotten.
 *
 * It takes a feed object rather than calling a hook, so the page above chooses
 * which endpoint it is showing.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { ShowtimePublic } from "shared"

import FeedFilterRail from "@/components/Feed/FeedFilterRail"
import FeedLayout from "@/components/Feed/FeedLayout"
import FeedPresets from "@/components/Feed/FeedPresets"
import FeedToolbar from "@/components/Feed/FeedToolbar"
import ShowtimeCard from "@/components/Showtimes/ShowtimeCard"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import type { FeedParams } from "@/features/showtimes/feed-params"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { useIsMobile } from "@/hooks/useIsMobile"

/** What every feed hook in `features/showtimes` returns. */
export type ShowtimeFeedLike = {
  params: FeedParams
  setParams: (patch: Partial<FeedParams>) => void
  resetParams: () => void
  activeFilterCount: number
  showtimes: ShowtimePublic[]
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => void
  isEmpty: boolean
  isFilteredEmpty: boolean
}

type ShowtimeFeedPageProps = {
  feed: ShowtimeFeedLike
  /** Sits above the toolbar — a cinema's name, whose agenda this is. */
  header?: ReactNode
  /** What to say when nothing matches, and when there is simply nothing. */
  emptyText?: string
  filteredEmptyText?: string
  /** False on the deep-link routes that sit outside `_layout`. */
  hasSidebar?: boolean
  /** Off where the filter set would not apply to the endpoint behind the feed. */
  showRail?: boolean
  /** Off on the pages whose filters are not the ones a preset saves. */
  showPresets?: boolean
}

const ShowtimeFeedPage = ({
  feed,
  header,
  emptyText = "No upcoming showtimes.",
  filteredEmptyText = "No showtimes match these filters.",
  hasSidebar = true,
  showRail = true,
  showPresets = true,
}: ShowtimeFeedPageProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isMobile = useIsMobile()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useInfiniteScroll({
    fetchNextPage: feed.fetchNextPage,
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    loadMoreRef,
    rootMargin: "400px",
  })

  // A showtime that has dropped out of the filtered result set should not keep
  // a panel open beside a feed that no longer contains it.
  const selected =
    feed.showtimes.find((showtime) => showtime.id === selectedId) ?? null
  useEffect(() => {
    if (selectedId !== null && !selected && !feed.isLoading) setSelectedId(null)
  }, [selectedId, selected, feed.isLoading])

  const handleSelect = useCallback((showtime: ShowtimePublic) => {
    setSelectedId((current) => (current === showtime.id ? null : showtime.id))
  }, [])
  const handleClose = useCallback(() => setSelectedId(null), [])

  const toolbar = (
    <Flex direction="column" gap={2}>
      <FeedToolbar
        params={feed.params}
        onChange={feed.setParams}
        onReset={feed.resetParams}
        activeFilterCount={feed.activeFilterCount}
        resultCount={feed.showtimes.length}
      />
      {showPresets ? (
        <FeedPresets params={feed.params} onChange={feed.setParams} />
      ) : null}
    </Flex>
  )

  // Render/output using the state and derived values prepared above.
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
      detail={
        selected ? (
          <ShowtimeDetailPanel showtime={selected} onClose={handleClose} />
        ) : null
      }
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

      {feed.showtimes.map((showtime) => (
        <ShowtimeCard
          key={showtime.id}
          showtime={showtime}
          going_status={showtime.viewer?.going}
          isSelected={showtime.id === selectedId}
          onSelect={handleSelect}
        />
      ))}

      {/* On a phone there is no room for a docked panel, so the selection opens
          under the list until it becomes a drawer. */}
      {isMobile && selected ? (
        <Box borderBottomWidth="1px" borderColor="border" p={3}>
          <ShowtimeDetailPanel showtime={selected} onClose={handleClose} />
        </Box>
      ) : null}

      {feed.hasNextPage ? (
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

export default ShowtimeFeedPage
