/**
 * Friends feature component: Friends Top Bar.
 */
import SearchBar from "@/components/Common/SearchBar";
import TopBar from "../Common/TopBar";

type FriendsTopBarProps = {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
};

const FriendsTopBar = ({
    searchQuery,
    setSearchQuery,
}: FriendsTopBarProps) => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    return (
        <TopBar>
            <SearchBar
                query={searchQuery}
                setQuery={setSearchQuery}
                placeholder="Search users..."
            />
        </TopBar>
    );
}

export default FriendsTopBar;
