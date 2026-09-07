import { Box, Button, Center, Flex, Spinner, Text } from "@chakra-ui/react"
/**
 * The website's home feed.
 *
 * It used to be hardcoded to the viewer's own going + interested showtimes,
 * which meant a signed-in visitor with an empty agenda got an empty homepage and
 * there was no way to browse the programme at all. It now defaults to
 * everything, with the old view available as a filter.
 *
 * The page owns only which showtime is selected. Filter state and data come
 * from `useShowtimesFeed`, and every pixel of geometry from `FeedLayout` — so
 * this file stays short and layout changes do not touch it.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { ShowtimePublic } from "shared"

import FeedFilterRail from "@/components/Feed/FeedFilterRail"
import FeedLayout from "@/components/Feed/FeedLayout"
import FeedToolbar from "@/components/Feed/FeedToolbar"
import ShowtimeCard from "@/components/Showtimes/ShowtimeCard"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import { useShowtimesFeed } from "@/features/showtimes/useShowtimesFeed"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { useIsMobile } from "@/hooks/useIsMobile"

const MainShowtimesPage = () => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const feed = useShowtimesFeed()
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

  // A showtime that has scrolled out of the filtered result set should not keep
  // a panel open beside a feed that no longer contains it.
  const selected =
    feed.showtimes.find((showtime) => showtime.id === selectedId) ?? null
  useEffect(() => {
    if (selectedId !== null && !selected && !feed.isLoading) {
      setSelectedId(null)
    }
  }, [selectedId, selected, feed.isLoading])

  const handleSelect = useCallback((showtime: ShowtimePublic) => {
    setSelectedId((current) => (current === showtime.id ? null : showtime.id))
  }, [])

  const handleClose = useCallback(() => setSelectedId(null), [])

  return (
    <FeedLayout
      rail={<FeedFilterRail params={feed.params} onChange={feed.setParams} />}
      toolbar={
        <FeedToolbar
          params={feed.params}
          onChange={feed.setParams}
          onReset={feed.resetParams}
          activeFilterCount={feed.activeFilterCount}
          resultCount={feed.showtimes.length}
        />
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
            <Text color="gray.500">
              {feed.isFilteredEmpty
                ? "No showtimes match these filters."
                : "No upcoming showtimes."}
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
          inline under the row it belongs to until it becomes a drawer. */}
      {isMobile && selected ? (
        <Box borderBottomWidth="1px" borderColor="gray.200" p={3}>
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

export default MainShowtimesPage
