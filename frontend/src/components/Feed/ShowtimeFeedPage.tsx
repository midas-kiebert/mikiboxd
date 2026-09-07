/**
 * Every showtime feed on the website: home, a cinema's programme, your agenda,
 * a friend's agenda. They differ only in where their rows come from and what
 * they say when empty.
 *
 * Owns which showtime is selected; everything around the rows is
 * `FeedPageShell`.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Box } from "@chakra-ui/react"
import type { ReactNode } from "react"
import type { ShowtimePublic } from "shared"

import FeedPageShell, { type FeedChrome } from "@/components/Feed/FeedPageShell"
import ShowtimeCard from "@/components/Showtimes/ShowtimeCard"
import ShowtimeDetailPanel from "@/components/Showtimes/ShowtimeDetailPanel"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { useIsMobile } from "@/hooks/useIsMobile"

/** What every showtime feed hook in `features/showtimes` returns. */
export type ShowtimeFeedLike = FeedChrome & {
  showtimes: ShowtimePublic[]
  fetchNextPage: () => void
}

type ShowtimeFeedPageProps = {
  feed: ShowtimeFeedLike
  header?: ReactNode
  emptyText?: string
  filteredEmptyText?: string
  hasSidebar?: boolean
  showRail?: boolean
  showPresets?: boolean
  showGroupToggle?: boolean
}

const ShowtimeFeedPage = ({
  feed,
  header,
  emptyText = "No upcoming showtimes.",
  filteredEmptyText = "No showtimes match these filters.",
  hasSidebar = true,
  showRail = true,
  showPresets = true,
  showGroupToggle = false,
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

  // Render/output using the state and derived values prepared above.
  return (
    <FeedPageShell
      feed={feed}
      resultCount={feed.showtimes.length}
      header={header}
      emptyText={emptyText}
      filteredEmptyText={filteredEmptyText}
      hasSidebar={hasSidebar}
      showRail={showRail}
      showPresets={showPresets}
      showGroupToggle={showGroupToggle}
      loadMoreRef={loadMoreRef}
      detail={
        selected ? (
          <ShowtimeDetailPanel showtime={selected} onClose={handleClose} />
        ) : null
      }
    >
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
    </FeedPageShell>
  )
}

export default ShowtimeFeedPage
