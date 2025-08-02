import { createFileRoute } from "@tanstack/react-router";
import MoviePage from "@/components/Movie/MoviePage";


//@ts-ignore
export const Route = createFileRoute("/movie/$movieId")({
    component: MoviePage,
})
