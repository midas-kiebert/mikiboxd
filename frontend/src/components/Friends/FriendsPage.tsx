/**
 * Friends feature component: Friends Page.
 */
import { Flex, Box, Grid } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import FriendsTopBar from "@/components/Friends/FriendsTopBar";
import { useState} from "react";
import SearchUsers from "@/components/Friends/SearchUsers";
import Friends from "@/components/Friends/Friends";
import ReceivedRequests from "@/components/Friends/ReceivedRequests";
import SentRequests from "@/components/Friends/SentRequests";

const FriendsPage = () => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const [searchQuery, setSearchQuery] = useState<string>("");

    // Render/output using the state and derived values prepared above.
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
