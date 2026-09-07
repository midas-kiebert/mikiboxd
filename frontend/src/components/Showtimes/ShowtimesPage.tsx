/**
 * A friend's agenda.
 *
 * Shows only what that person's visibility settings let you see, which the
 * endpoint decides — this page just renders what comes back.
 */
import { Heading } from "@chakra-ui/react"
import { useGetUser } from "shared/hooks/useGetUser"

import ShowtimeFeedPage from "@/components/Feed/ShowtimeFeedPage"
import { useFriendAgendaFeed } from "@/features/showtimes/useAgendaFeeds"

type ShowtimesPageProps = {
  userId: string
}

const ShowtimesPage = ({ userId }: ShowtimesPageProps) => {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const feed = useFriendAgendaFeed(userId)
  const { data: user } = useGetUser({ userId })
  const name = user?.display_name ?? "This person"

  // Render/output using the state and derived values prepared above.
  return (
    <ShowtimeFeedPage
      feed={feed}
      showPresets={false}
      header={<Heading size="md">{name}'s agenda</Heading>}
      emptyText={`${name} has nothing coming up that you can see.`}
      filteredEmptyText="Nothing here matches these filters."
    />
  )
}

export default ShowtimesPage
