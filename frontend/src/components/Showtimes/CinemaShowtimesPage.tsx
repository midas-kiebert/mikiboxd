/**
 * One cinema's programme.
 *
 * The route used to be a stub that told the visitor to open the app. It is the
 * home feed with that cinema pinned — the same list, the same filters, the same
 * detail panel — because that is what the page is, and building a second feed
 * for it would only guarantee the two drift.
 *
 * The cinema stays pinned through "clear filters", so clearing removes the
 * visitor's own choices without navigating them off the cinema they opened.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Center, Flex, Heading, Link, Spinner, Text } from "@chakra-ui/react"
import type { ShowtimePublic } from "shared"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"

import FeedFilterRail from "@/components/Feed/FeedFilterRail"
import FeedLayout from "@/components/Feed/FeedLayout"
import FeedToolbar from "@/components/Feed/FeedToolbar"
import ShowtimeCard from "@/components/Showtimes/ShowtimeCard"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import { useShowtimesFeed } from "@/features/showtimes/useShowtimesFeed"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { useIsMobile } from "@/hooks/useIsMobile"

type CinemaShowtimesPageProps = {
  cinemaId: number
}

const CinemaShowtimesPage = ({ cinemaId }: CinemaShowtimesPageProps) => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const pinned = useMemo(
    () => ({ cinemas: [cinemaId], allCinemas: true }),
    [cinemaId],
  )
  const feed = useShowtimesFeed({ pinned })
  const isMobile = useIsMobile()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: cinemas } = useFetchCinemas()
  const cinema = cinemas?.find((entry) => entry.id === cinemaId)

  useInfiniteScroll({
    fetchNextPage: feed.fetchNextPage,
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    loadMoreRef,
    rootMargin: "400px",
  })

  const selected =
    feed.showtimes.find((showtime) => showtime.id === selectedId) ?? null
  useEffect(() => {
    if (selectedId !== null && !selected && !feed.isLoading) setSelectedId(null)
  }, [selectedId, selected, feed.isLoading])

  const handleSelect = useCallback((showtime: ShowtimePublic) => {
    setSelectedId((current) => (current === showtime.id ? null : showtime.id))
  }, [])
  const handleClose = useCallback(() => setSelectedId(null), [])

  return (
    <FeedLayout
      hasSidebar={false}
      rail={<FeedFilterRail params={feed.params} onChange={feed.setParams} />}
      toolbar={
        <Flex direction="column" gap={2}>
          <Flex align="baseline" gap={3} wrap="wrap">
            <Heading size="md">{cinema?.name ?? "Cinema"}</Heading>
            {cinema ? (
              <Text color="fg.muted" fontSize="sm">
                {cinema.city.name}
              </Text>
            ) : null}
            {cinema?.url ? (
              <Link
                href={cinema.url}
                target="_blank"
                rel="noopener noreferrer"
                fontSize="sm"
              >
                Website
              </Link>
            ) : null}
          </Flex>
          <FeedToolbar
            params={feed.params}
            onChange={feed.setParams}
            onReset={feed.resetParams}
            activeFilterCount={feed.activeFilterCount}
            resultCount={feed.showtimes.length}
          />
        </Flex>
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
              {feed.isFilteredEmpty
                ? "No showtimes here match these filters."
                : "Nothing showing at this cinema right now."}
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

export default CinemaShowtimesPage
