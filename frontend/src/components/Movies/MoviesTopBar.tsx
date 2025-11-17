import SearchBar from "../Common/SearchBar";
import WatchlistToggle from "./WatchlistToggle";
import TopBar from "../Common/TopBar";
import Filters from "./Filters";
import { Spacer } from "@chakra-ui/react";
import UserMenu from "../Common/UserMenu";

type MoviesTopBarProps = {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    watchlistOnly: boolean;
    setWatchlistOnly: (value: boolean) => void;
    sideBarWidth?: string;
};

const MoviesTopBar = ({
    searchQuery,
    setSearchQuery,
    watchlistOnly,
    setWatchlistOnly,

}: MoviesTopBarProps) => {
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
            <Filters />
            <Spacer />
            <UserMenu />
        </TopBar>
    );
}

export default MoviesTopBar;
