/**
 * Your agenda: the showtimes you have marked yourself going to or interested in.
 *
 * Was an inert list with no filters and no way to act on a row. It is the same
 * feed page as everything else now, so a full agenda can be narrowed to
 * tonight and a status changed without leaving it.
 */
import { Heading } from "@chakra-ui/react"

import ShowtimeFeedPage from "@/components/Feed/ShowtimeFeedPage"
import { useMyAgendaFeed } from "@/features/showtimes/useAgendaFeeds"

const MyShowtimesPage = () => {
  const feed = useMyAgendaFeed()

  return (
    <ShowtimeFeedPage
      feed={feed}
      header={<Heading size="md">Your agenda</Heading>}
      emptyText="Nothing in your agenda yet. Mark a showtime going or interested and it lands here."
      filteredEmptyText="Nothing in your agenda matches these filters."
    />
  )
}

export default MyShowtimesPage
