import { Box } from "@chakra-ui/react";
import SearchBar from "./SearchBar";
import WatchlistToggle from "./WatchlistToggle";

type TopBarProps = {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    watchlistOnly: boolean;
    setWatchlistOnly: (value: boolean) => void;
};

const TopBar = ({
    searchQuery,
    setSearchQuery,
    watchlistOnly,
    setWatchlistOnly,
}: TopBarProps) => {
    return (
        <Box
            position="sticky"
            top="0"
            zIndex="sticky"
            bg="white"
            px={4}
            py={2}
            boxShadow="sm"
            display="flex"
            gap={4}
        >
            <SearchBar query={searchQuery} setQuery={setSearchQuery}/>
            <WatchlistToggle
                watchlistOnly={watchlistOnly}
                setWatchlistOnly={setWatchlistOnly}
            />
        </Box>
    );
}

export default TopBar;
