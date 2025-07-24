import { createFileRoute } from "@tanstack/react-router";
import { MoviesService, MoviesReadMovieResponse } from "@/client";
import { useQuery } from "@tanstack/react-query";
import MovieTitle from "@/components/Movie/MovieTitle";
import MoviePoster from "@/components/Movie/MoviePoster";
import MovieLinks from "@/components/Movie/MovieLinks";
import { Showtimes } from "@/components/Movie/Showtimes";
import { Flex } from "@chakra-ui/react";
import Sidebar from "@/components/Common/Sidebar";
import TopBar from "@/components/Common/TopBar";
import Page from "@/components/Common/Page";

const MoviePage = () => {
    const params = Route.useParams();
    const { movieId } = params as { movieId: string };

    const { data } = useQuery<MoviesReadMovieResponse, Error>({
        queryKey: ["movie", movieId],
        queryFn: () => MoviesService.readMovie({ id: Number(movieId) })
    });

    const showtimesNoFriends = data?.showtime_without_friends || [];
    const showtimesWithFriends = data?.showtimes_with_friends || [];

    const posterUrl = data?.poster_link || "https://via.placeholder.com/300x450.png?text=No+Poster+Available"

    const letterboxdSlug = data?.letterboxd_slug || "";

    return (
        <>
            <Flex>
                <Sidebar/>
                <TopBar/>
            </Flex>
            <Page>
                <MovieTitle title={data?.title || ""} />
                <MoviePoster
                    posterUrl={posterUrl}
                />
                <MovieLinks
                    // imdb="https://www.imdb.com/title/tt1234567/"
                    letterboxd={`https://letterboxd.com/film/${letterboxdSlug}`}
                />
                <Showtimes showtimes={showtimesWithFriends} />
                <Showtimes showtimes={showtimesNoFriends} />
            </Page>
        </>
    );
};

//@ts-ignore
export const Route = createFileRoute("/movie/$movieId")({
    component: MoviePage,
})
