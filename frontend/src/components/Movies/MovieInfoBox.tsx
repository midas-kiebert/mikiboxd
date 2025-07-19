import { Box } from "@chakra-ui/react";
import MovieTitle from "./MovieTitle";
import { MovieSummaryPublic } from "@/client";
import CinemaBadge from "../Movie/CinemaBadge";

type MovieInfoBoxProps = {
    movie: MovieSummaryPublic;
};

export default function MovieInfoBox({ movie } : MovieInfoBoxProps) {
    const showtimes = movie.showtimes;
    const firstShowtime = showtimes ? showtimes[0] : null;
    const firstShowtimeCinema = firstShowtime ? firstShowtime.cinema : null;

    return (
        <Box
            mx={8}
            bg="blue.200"
            flex="1"
        >
            <MovieTitle title={movie.title} />
            {
                firstShowtimeCinema && (
                    <CinemaBadge
                        cinema={firstShowtimeCinema}
                    />
                )
            }
            <Box>
                +16 more showtimes in Eye, LAB111, FilmHallen, ... until 2025-12-31
            </Box>
        </Box>
    )
}
