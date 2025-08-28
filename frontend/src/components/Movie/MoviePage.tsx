import { MoviesService, MoviesReadMovieResponse } from "@/client";
import { useQuery } from "@tanstack/react-query";
import MovieTitle from "@/components/Movie/MovieTitle";
import MoviePoster from "@/components/Movie/MoviePoster";
import MovieLinks from "@/components/Movie/MovieLinks";
import { Showtimes } from "@/components/Movie/Showtimes";
import { Flex, Box } from "@chakra-ui/react";
import Sidebar from "@/components/Common/Sidebar";
import TopBar from "@/components/Common/TopBar";
import Page from "@/components/Common/Page";
import { Route } from "@/routes/movie.$movieId";
import OriginalTitle from "./OriginalTitle";
import ReleaseYear from "./ReleaseYear";
import Directors from "./Directors";

const MoviePage = () => {
    const params = Route.useParams();
    const { movieId } = params as { movieId: string };

    const { data } = useQuery<MoviesReadMovieResponse, Error>({
        queryKey: ["movie", movieId],
        queryFn: () => MoviesService.readMovie({ id: Number(movieId) })
    });

    const showtimes = data?.showtimes || [];

    const posterUrl = data?.poster_link || "https://via.placeholder.com/300x450.png?text=No+Poster+Available"

    const letterboxdSlug = data?.letterboxd_slug || "";

    return (
        <>
            <Flex>
                <Sidebar/>
                <TopBar/>
            </Flex>
            <Page>
                <Flex gap={4}>
                    <MoviePoster posterUrl={posterUrl}/>
                    <Flex flexDirection={"column"} flex={1} minW={0} justifyContent={"top"}>
                    <Flex alignItems={"baseline"} gap={4}>
                        <MovieTitle title={data?.title || ""} />
                        <ReleaseYear releaseYear={data?.release_year || null} />
                        <OriginalTitle originalTitle={data?.original_title || null} />
                    </Flex>
                    <Directors directors={data?.directors || null} />
                    <MovieLinks
                        letterboxd={`https://letterboxd.com/film/${letterboxdSlug}`}
                    />
                    </Flex>
                </Flex>

                <Showtimes showtimes={showtimes} />
            </Page>
        </>
    );
};

export default MoviePage;
