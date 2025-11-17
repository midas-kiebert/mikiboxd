import { Flex } from "@chakra-ui/react";
import MoviePoster from "./MoviePoster";
import MovieInfoBox from "./MovieInfoBox";
import { MovieSummaryLoggedIn } from "@/client";
import React from "react";

type MovieCardProps = {
    movie: MovieSummaryLoggedIn;
};

const MovieCard = React.memo(function MovieCard({ movie }: MovieCardProps) {
    return (
        <>
        <Flex
            bg={ movie.going ? "green.200" : "gray.50"}
            borderBottom={"1px solid"}
            borderColor={"gray.200"}
            py={3}
            px={2}
            height={{base: "125px", md: "250px"}}
        >
            <MoviePoster movie={movie}/>
            <MovieInfoBox movie={movie}/>
        </Flex>
        </>
    );
});

export default MovieCard;
