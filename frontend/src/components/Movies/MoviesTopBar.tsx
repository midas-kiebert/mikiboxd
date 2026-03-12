import { Spacer } from "@chakra-ui/react"
/**
 * Movies list feature component: Movies Top Bar.
 */
import SearchBar from "../Common/SearchBar"
import TopBar from "../Common/TopBar"
import UserMenu from "../Common/UserMenu"
import Filters from "./Filters"
import WatchlistToggle from "./WatchlistToggle"

type MoviesTopBarProps = {
  searchQuery: string
  setSearchQuery: (query: string) => void
  watchlistOnly: boolean
  setWatchlistOnly: (value: boolean) => void
  sideBarWidth?: string
  selectedDays: Date[]
  handleDaysChange: (days: Date[]) => void
}

const MoviesTopBar = ({
  searchQuery,
  setSearchQuery,
  watchlistOnly,
  setWatchlistOnly,
  selectedDays,
  handleDaysChange,
}: MoviesTopBarProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <TopBar>
      <SearchBar
        query={searchQuery}
        setQuery={setSearchQuery}
        placeholder="Search movies..."
      />
      <WatchlistToggle
        watchlistOnly={watchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
      />
      <Filters
        selectedDays={selectedDays}
        handleDaysChange={handleDaysChange}
      />
      <Spacer />
      <UserMenu />
    </TopBar>
  )
}

export default MoviesTopBar
