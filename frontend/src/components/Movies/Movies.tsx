// load all movie cards

import { MovieSummaryPublic } from "@/client";
import MovieCard from "./MovieCard";

type MoviesProps = {
    movies: Array<MovieSummaryPublic>
}

export default function Movies( { movies } : MoviesProps) {
    return (
        <div className="movies-container">
            <h1 className="movies-title">Movies</h1>
            {movies.map((movie) => (
                <MovieCard
                    key={movie.id}
                    id={movie.id}
                    title={movie.title}
                    posterLink={movie.poster_link}
                />
            ))}
        </div>
    );
}