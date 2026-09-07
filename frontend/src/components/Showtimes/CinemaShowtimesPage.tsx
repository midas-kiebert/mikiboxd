import { Flex, Heading, Link, Text } from "@chakra-ui/react"
/**
 * One cinema's programme.
 *
 * The route used to be a stub that told the visitor to open the app. It is the
 * home feed with that cinema pinned — the same list, the same filters, the same
 * detail panel — because that is what the page is, and a second feed would only
 * drift from the first.
 *
 * The cinema stays pinned through "clear filters", so clearing removes the
 * visitor's own choices without navigating them off the cinema they opened.
 */
import { useMemo } from "react"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"

import ShowtimeFeedPage from "@/components/Feed/ShowtimeFeedPage"
import { useShowtimesFeed } from "@/features/showtimes/useShowtimesFeed"

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
  const { data: cinemas } = useFetchCinemas()
  const cinema = cinemas?.find((entry) => entry.id === cinemaId)

  // Render/output using the state and derived values prepared above.
  return (
    <ShowtimeFeedPage
      feed={feed}
      hasSidebar={false}
      emptyText="Nothing showing at this cinema right now."
      filteredEmptyText="No showtimes here match these filters."
      header={
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
      }
    />
  )
}

export default CinemaShowtimesPage
