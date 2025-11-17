import { Flex, Box, Grid } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import FriendsTopBar from "@/components/Friends/FriendsTopBar";
import { useState} from "react";
import SearchUsers from "@/components/Friends/SearchUsers";
import Friends from "@/components/Friends/Friends";
import ReceivedRequests from "@/components/Friends/ReceivedRequests";
import SentRequests from "@/components/Friends/SentRequests";

const FriendsPage = () => {
    const [searchQuery, setSearchQuery] = useState<string>("");

    return (
        <>
            <Flex>
                <FriendsTopBar
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                />
            </Flex>
            <Page>
                <Grid templateColumns="1fr 1fr" gap={4}>
                    <Box
                        // bg={"green.50"}
                        minH={"calc(100vh - 64px)"}
                        py={4}
                        px={2}
                    >
                        <SearchUsers query={searchQuery}/>
                    </Box>
                    <Box
                        // bg={"green.50"}
                        py={4}
                        px={2}
                    >
                        <ReceivedRequests/>
                        <SentRequests/>
                        <Friends/>
                    </Box>
                </Grid>
            </Page>
        </>
    );
};

export default FriendsPage;
