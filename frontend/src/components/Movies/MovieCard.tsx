import { Flex } from "@chakra-ui/react";
import MoviePoster from "./MoviePoster";
import MovieInfoBox from "./MovieInfoBox";
import { MovieSummaryPublic } from "@/client";
import React from "react";

type MovieCardProps = {
    movie: MovieSummaryPublic;
};

const MovieCard = React.memo(function MovieCard({ movie }: MovieCardProps) {
    return (
        <>
        <Flex
            bg={ movie.going ? "green.200" : "gray.100"}
            borderBottom={"1px solid"}
            borderColor={"gray.300"}
            py={3}
            px={2}
            height="250px"
        >
            <MoviePoster movie={movie}/>
            <MovieInfoBox movie={movie}/>
        </Flex>
        </>
    );
});

export default MovieCard;
