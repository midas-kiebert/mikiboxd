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
    return (
        <TopBar>
            Friends {searchQuery} {setSearchQuery.toString()}
            <SearchBar
                query={searchQuery}
                setQuery={setSearchQuery}
                placeholder="Search users..."
            />
        </TopBar>
    );
}

export default FriendsTopBar;
