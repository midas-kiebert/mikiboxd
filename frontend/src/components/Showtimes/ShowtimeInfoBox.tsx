import { Separator, Flex, Box } from "@chakra-ui/react";
import MovieTitle from "../Movies/MovieTitle";
import FriendBadges from "../Movies/FriendBadges";
import { ShowtimeLoggedIn } from "@/client";
import CinemaBadge from "../Common/CinemaBadge";

function formatTime(datetime: string): string {
    return new Date(datetime).toLocaleTimeString([], {
        weekday: "short",
        month: "short",
        day: "2-digit",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
    });
  }


type ShowtimeInfoBoxProps = {
    showtime: ShowtimeLoggedIn;
};

export default function ShowtimeInfoBox({ showtime } : ShowtimeInfoBoxProps) {
    const friendsGoing = showtime.friends_going;
    return (
        <Flex
            ml={8}
            flex="1"
            flexDirection="column"
            minW={0}
        >
            <Flex gap={2}>
                <MovieTitle title={showtime.movie.title} />
                <CinemaBadge cinema={showtime.cinema} />
            </Flex>
            <Flex flex="1">
                <FriendBadges friends={friendsGoing}/>
            </Flex>
        </Flex>
    )
}
