import { Box} from "@chakra-ui/react";
import MovieTitle from "./MovieTitle";
import { MovieSummaryPublic } from "@/client";
import CinemaBadges from "./CinemaBadges";
import ShowtimeInfo from "./ShowtimeInfo";
import FriendBadges from "./FriendBadges";



type MovieInfoBoxProps = {
    movie: MovieSummaryPublic;
};

export default function MovieInfoBox({ movie } : MovieInfoBoxProps) {
    const showtimes = movie.showtimes || [];
    const cinemas = movie.cinemas || [];
    const lastShowtime = movie.last_showtime_datetime || null;
    const total_showtimes = movie.total_showtimes || 0;
    const friends_going = movie.friends_going || [];
    return (
        <Box
            mx={8}
            // bg="blue.200"
            flex="1"
            display={"flex"}
            flexDirection="column"
        >
            <MovieTitle title={movie.title} />
            <CinemaBadges cinemas={cinemas} />
            <Box display={"flex"}>
                <ShowtimeInfo
                    showtimes={showtimes}
                    lastShowtime={lastShowtime}
                    total_showtimes={total_showtimes}
                />
                <FriendBadges friends={friends_going}/>
            </Box>
        </Box>
    )
}
