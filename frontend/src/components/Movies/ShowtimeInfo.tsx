import { Box, Text } from "@chakra-ui/react";
import ShowtimeList from "@/components/Movies/ShowtimeList";
import type { ShowtimeInMoviePublic } from "@/client";
import MoreShowtimes from "./MoreShowtimes";




type ShowtimeInfoProps = {
    showtimes: ShowtimeInMoviePublic[];
    lastShowtime?: string | null;
    total_showtimes: number;
};

export default function ShowtimeInfo({
    showtimes,
    lastShowtime = null,
    total_showtimes = 0,
}: ShowtimeInfoProps) {
    return (
        <Box
            // bg="orange.100"
            width={"50%"}
            maxW={"50%"}
            overflow={"cover"}
            flex="1"
            // display={"flex"}
            height={"100%"}
            pl={0.5}
        >
            <ShowtimeList showtimes={showtimes} />
            <MoreShowtimes
                lastShowtime={lastShowtime}
                additional_showtime_count={total_showtimes - showtimes.length}
            />
        </Box>
    );
}
