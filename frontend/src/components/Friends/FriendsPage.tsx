import { Flex } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import Sidebar from "@/components/Common/Sidebar";
import FriendsTopBar from "@/components/Friends/FriendsTopBar";
import { useState} from "react";
import SearchUsers from "@/components/Friends/SearchUsers";

const FriendsPage = () => {
    const [searchQuery, setSearchQuery] = useState<string>("");

    return (
        <>
            <Flex>
                <Sidebar/>
                <FriendsTopBar
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                />
            </Flex>
            <Page>
                <SearchUsers query={searchQuery}/>
            </Page>
        </>
    );
};

export default FriendsPage;
