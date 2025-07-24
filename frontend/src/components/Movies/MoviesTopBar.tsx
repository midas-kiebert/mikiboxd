import SearchBar from "./SearchBar";
import WatchlistToggle from "./WatchlistToggle";
import TopBar from "../Common/TopBar";

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
            <SearchBar query={searchQuery} setQuery={setSearchQuery}/>
            <WatchlistToggle
                watchlistOnly={watchlistOnly}
                setWatchlistOnly={setWatchlistOnly}
            />
        </TopBar>
    );
}

export default MoviesTopBar;
