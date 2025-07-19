import { Box } from "@chakra-ui/react";
import MoviePoster from "./MoviePoster";
import MovieInfoBox from "./MovieInfoBox";
import { MovieSummaryPublic } from "@/client";

type MovieCardProps = {
    movie: MovieSummaryPublic;
};

export default function MovieCard({ movie }: MovieCardProps) {
    return (
        <>
        <Box
            bg="gray.100"
            borderBottom={"1px solid"}
            borderColor={"gray.300"}
            py={3}
            px={2}
            height="250px"
            display="flex"
        >
            <MoviePoster movie={movie}/>
            <MovieInfoBox movie={movie}/>
        </Box>
        </>
    );
}
