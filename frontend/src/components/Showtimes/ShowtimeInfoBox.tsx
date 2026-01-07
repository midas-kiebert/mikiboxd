import { Flex, Stack } from "@chakra-ui/react";
import MovieTitle from "../Movies/MovieTitle";
import FriendBadges from "../Movies/FriendBadges";
import { ShowtimeLoggedIn } from "@/client";
import CinemaBadge from "../Common/CinemaBadge";
import { useIsMobile } from "@/hooks/useIsMobile";


type ShowtimeInfoBoxProps = {
    showtime: ShowtimeLoggedIn;
};

export default function ShowtimeInfoBox({ showtime } : ShowtimeInfoBoxProps) {
    const friendsGoing = showtime.friends_going;
    const friendsInterested = showtime.friends_interested;
    const isMobile = useIsMobile();
    return (
        <Flex
            ml={ isMobile ? 2 : 8}
            flex="1"
            flexDirection="column"
            minW={0}
        >
            <Stack
                gap={ isMobile ? 0 : 2}
                direction={isMobile ? "column" : "row"}
                align={ isMobile ? "flex-start" : "center"}
            >
            {/* <Flex gap={2} */}
                <MovieTitle title={showtime.movie.title} />
                <CinemaBadge cinema={showtime.cinema} />
            {/* </Flex> */}
            </Stack>
            <Flex flex="1">
                <FriendBadges friends={friendsGoing} goingStatus="GOING"/>
                <FriendBadges friends={friendsInterested} goingStatus="INTERESTED"/>
            </Flex>
        </Flex>
    )
}
