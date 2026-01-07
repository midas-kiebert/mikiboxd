import { Separator, Flex } from "@chakra-ui/react";
import MovieTitle from "./MovieTitle";
import OriginalTitle from "./OriginalTitle";
import { MovieSummaryLoggedIn } from "@/client";
import CinemaBadges from "./CinemaBadges";
import ShowtimeInfo from "./ShowtimeInfo";
import FriendBadges from "./FriendBadges";



type MovieInfoBoxProps = {
    movie: MovieSummaryLoggedIn;
};

const goingBorderMap: Record<string, string> = {
    GOING: "green.500",
    INTERESTED: "orange.500",
    NOT_GOING: "gray.300",
  };


export default function MovieInfoBox({ movie } : MovieInfoBoxProps) {
    const showtimes = movie.showtimes || [];
    const cinemas = movie.cinemas || [];
    const lastShowtime = movie.last_showtime_datetime || null;
    const total_showtimes = movie.total_showtimes || 0;
    const friends_going = movie.friends_going || [];
    const friends_interested = movie.friends_interested || [];
    const original_title = movie.original_title || null;
    return (
        <Flex
            ml={{base: 2, md: 8}}
            // bg="blue.200"
            flex="1"
            flexDirection="column"
            minW={0}
        >
            <Flex gap={"2"} align="center">
                <MovieTitle title={movie.title} />
                <OriginalTitle originalTitle={original_title} />
                <CinemaBadges cinemas={cinemas} />
            </Flex>
            <Separator
                mt={0.5}
                mb={2}
                borderColor={goingBorderMap[movie.going]}
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
                    borderColor={goingBorderMap[movie.going]}
                />
                <FriendBadges friends={friends_going} goingStatus="GOING"/>
                <FriendBadges friends={friends_interested} goingStatus="INTERESTED"/>
            </Flex>
        </Flex>
    )
}
