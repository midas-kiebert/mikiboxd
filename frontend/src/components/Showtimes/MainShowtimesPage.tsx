/**
 * The website's home feed.
 *
 * It used to be hardcoded to the viewer's own going + interested showtimes, so
 * a signed-in visitor with an empty agenda got an empty homepage and there was
 * no way to browse the programme at all. It now defaults to everything, with
 * the old view available as a filter.
 */
import ShowtimeFeedPage from "@/components/Feed/ShowtimeFeedPage"
import { useShowtimesFeed } from "@/features/showtimes/useShowtimesFeed"

const MainShowtimesPage = () => {
  const feed = useShowtimesFeed()
  return <ShowtimeFeedPage feed={feed} />
}

export default MainShowtimesPage
