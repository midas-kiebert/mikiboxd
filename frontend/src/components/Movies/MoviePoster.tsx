import { Link } from "@tanstack/react-router"
import { MovieSummaryLoggedIn } from "@/client";
import { Box, Image } from "@chakra-ui/react";

type MoviePosterProps = {
    movie: MovieSummaryLoggedIn;
    size?: {base: string, md: string};
};

export default function MoviePoster({
    movie,
    size = {base: "100px", md: "225px"}
}: MoviePosterProps) {
    const borderRadius = {base: "3px", md: "0px"};
    const width = {base: "66px", md: "150px"}
    return (
        <Box
            as="div"
            display="inline-block"
            height={size}
            width={width}
        >
            <Link
                to={"/movie/$movieId"}
                params={{ movieId: `${movie.id}`}}
            >
                <Image
                    src={movie.poster_link || "https://via.placeholder.com/150"}
                    alt={movie.title}
                    width="100%"
                    height="100%"
                    objectFit="cover"
                    borderRadius={borderRadius}
                />
            </Link>
        </Box>
    );
}
