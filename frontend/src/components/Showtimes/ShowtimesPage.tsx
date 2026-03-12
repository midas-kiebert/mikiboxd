import type { UUID } from "node:crypto"
import Page from "@/components/Common/Page"
import { Showtimes } from "@/components/Showtimes/Showtimes"
import useInfiniteScroll from "@/hooks/useInfiniteScroll"
import { Center, Spinner } from "@chakra-ui/react"
import { DateTime } from "luxon"
/**
 * Showtimes feature component: Showtimes Page.
 */
import { useRef, useState } from "react"
import { useFetchUserShowtimes } from "shared/hooks/useFetchUserShowtimes"
import { useGetUser } from "shared/hooks/useGetUser"

type ShowtimesPageProps = {
  userId: UUID
}

const ShowtimesPage = ({ userId }: ShowtimesPageProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const limit = 20
  const [snapshotTime] = useState(() =>
    DateTime.now()
      .setZone("Europe/Amsterdam")
      .toFormat("yyyy-MM-dd'T'HH:mm:ss"),
  )
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useFetchUserShowtimes({
    limit: limit,
    snapshotTime,
    userId: userId,
  })

  useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    loadMoreRef,
    rootMargin: "200px",
  })

  const showtimes = data?.pages.flat() ?? []

  const { data: user } = useGetUser({ userId })

  if ((isLoading || isFetching) && !isFetchingNextPage) {
    return (
      <>
        <Center h="100vh">
          <Spinner size="xl" />
        </Center>
      </>
    )
  }

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <Page>
        <h1>Showtimes for {user?.display_name}</h1>
        <Showtimes showtimes={showtimes} />
        {hasNextPage && <div ref={loadMoreRef} style={{ height: "1px" }} />}
        {isFetchingNextPage && (
          <div style={{ textAlign: "center", padding: "20px" }}>
            Loading more showtimes...
          </div>
        )}
      </Page>
    </>
  )
}

export default ShowtimesPage
