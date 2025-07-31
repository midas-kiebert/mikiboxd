// load all movie cards

import { MovieSummaryLoggedIn } from "@/client";
import MovieCard from "./MovieCard";
import MoviesContainer from "./MoviesContainer";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect } from "react";

type MoviesProps = {
    movies: Array<MovieSummaryLoggedIn>
}

export default function Movies( { movies } : MoviesProps) {
    // keep track of the scroll position at all times
    useEffect(() => {
        const handleScroll = () => {
            sessionStorage.setItem('scrollPosition', window.scrollY.toString())
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const initialOffset = sessionStorage.getItem('scrollPosition')
                        ? parseInt(sessionStorage.getItem('scrollPosition')!)
                        : 0;

    const rowVirtualizer = useWindowVirtualizer({
        count: movies.length,
        estimateSize: () => 250, // Estimate height of each movie card
        overscan: 2, // Number of items to render outside the visible area
        initialOffset
    })

    return (
        <MoviesContainer>
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const movie = movies[virtualRow.index];
                        if (!movie) return null;

                        return (
                            <div
                                key={movie.id}
                                data-index={virtualRow.index}
                                ref={rowVirtualizer.measureElement}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                            >
                                <MovieCard movie={movie} />
                            </div>
                        );
                    })}
                </div>
        </MoviesContainer>
    );
}
