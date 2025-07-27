import dayjs from "dayjs"
import Day from "@/components/Movie/Day"

import type { ShowtimeInMoviePublic } from "@/client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ShowtimesService, ShowtimesToggleShowtimeSelectionResponse } from "@/client"
import type { MoviesReadMovieResponse } from "@/client"
import type { MovieSummaryPublic } from "@/client"

type GroupedShowtimes = Record<string, { showtimesForDate: ShowtimeInMoviePublic[] }>

type InfiniteMoviesData = {
    pages: MovieSummaryPublic[][];
    pageParams: unknown[];
};

export function groupShowtimesByDate(showtimes: ShowtimeInMoviePublic[]): GroupedShowtimes {
    return showtimes.reduce((acc, showtime) => {
        const dateKey = dayjs(showtime.datetime).format("YYYY-MM-DD")
        if (!acc[dateKey]) {
            acc[dateKey] = { showtimesForDate: [] }
        }
        acc[dateKey].showtimesForDate.push(showtime)
        return acc
    }, {} as GroupedShowtimes)
}

type ShowtimeProps = {
    showtimes: ShowtimeInMoviePublic[]
}

type UpdateCacheData = {
    movieId: number;
    showtimeId: number;
    newValue: boolean;
}

export function Showtimes( { showtimes } : ShowtimeProps  ) {
    const queryClient = useQueryClient();

    const updateCacheAfterShowtimeToggle = ({ movieId, showtimeId, newValue } : UpdateCacheData) => {

        // update the cache in the movie details page
        queryClient.setQueryData(['movie', String(movieId)], (oldData: MoviesReadMovieResponse | undefined) => {
            if (!oldData || !oldData.showtimes) return;

            const newShowtimes = oldData.showtimes.map((s) =>
                s.id === showtimeId ? { ...s, going: newValue } : s
            );

            return {
                ...oldData,
                showtimes: newShowtimes,
            };
        });

        // new showtimes with going flag updated
        const updatedShowtimes = showtimes.map((s) =>
            s.id === showtimeId ? { ...s, going: newValue } : s
        );
        const going = updatedShowtimes.some((s) => s.going); // true if going to any showtime

        const movieQueries = queryClient.getQueriesData<InfiniteMoviesData>({ queryKey: ['movies'] });
        movieQueries.forEach(([queryKey, oldData]) => {
            if (!oldData) return;

            const newPages = oldData.pages.map((page) => {
                const newResults = page.map((movie) =>
                    movie.id === movieId ? {...movie, going: going} : movie
                );
                return newResults;
            });

            queryClient.setQueryData(queryKey, {
                ...oldData,
                pages: newPages,
            });
        });
    }

    const {mutate: handleToggle} = useMutation<ShowtimesToggleShowtimeSelectionResponse, Error, number>({
        mutationFn: (showtimeId) => ShowtimesService.toggleShowtimeSelection({ showtimeId }),
        onSuccess: (data) => {
            console.log("Showtime toggled", data);
            updateCacheAfterShowtimeToggle({
                movieId: data.movie.id,
                showtimeId: data.id,
                newValue: data.going ?? false
            });
        },
        onError: (error) => {
            console.error("Error toggling showtime:", error);
        }
    });



    const grouped = groupShowtimesByDate(showtimes)

    return (
        <>
            {Object.entries(grouped).map(([date, { showtimesForDate}]) => (
                <Day
                    key={date}
                    date={date}
                    showtimes={showtimesForDate}
                    handleToggle={handleToggle}
                />
            ))}
        </>
    )
}
