// load all movie cards

import { MovieSummaryPublic } from "@/client";
import MovieCard from "./MovieCard";
import MoviesContainer from "./MoviesContainer";

type MoviesProps = {
    movies: Array<MovieSummaryPublic>
}

export default function Movies( { movies } : MoviesProps) {
    return (
        <MoviesContainer>
            {movies.map((movie) => (
                <MovieCard
                    movie={movie}
                    key={movie.id}
                />
            ))}
        </MoviesContainer>
    );
}
