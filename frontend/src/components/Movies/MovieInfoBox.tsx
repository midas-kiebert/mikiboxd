import { Separator, Flex } from "@chakra-ui/react";
import MovieTitle from "./MovieTitle";
import { MovieSummaryLoggedIn } from "@/client";
import CinemaBadges from "./CinemaBadges";
import ShowtimeInfo from "./ShowtimeInfo";
import FriendBadges from "./FriendBadges";



type MovieInfoBoxProps = {
    movie: MovieSummaryLoggedIn;
};

export default function MovieInfoBox({ movie } : MovieInfoBoxProps) {
    const showtimes = movie.showtimes || [];
    const cinemas = movie.cinemas || [];
    const lastShowtime = movie.last_showtime_datetime || null;
    const total_showtimes = movie.total_showtimes || 0;
    const friends_going = movie.friends_going || [];
    return (
        <Flex
            ml={8}
            // bg="blue.200"
            flex="1"
            flexDirection="column"
            minW={0}
        >
            <Flex gap={"2"} align="center">
                <MovieTitle title={movie.title} />
                <CinemaBadges cinemas={cinemas} />
            </Flex>
            <Separator
                mt={0.5}
                mb={2}
                borderColor={movie.going ? "green.500" : "gray.300"}
            />
            <Flex flex="1">
                <ShowtimeInfo
                    showtimes={showtimes}
                    lastShowtime={lastShowtime}
                    total_showtimes={total_showtimes}
                />
                <Separator
                    orientation={"vertical"}
                    mx={2}
                    borderColor={movie.going ? "green.500" : "gray.300"}
                />
                <FriendBadges friends={friends_going}/>
            </Flex>
        </Flex>
    )
}
