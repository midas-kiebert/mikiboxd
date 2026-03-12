import MoviePage from "@/components/Movie/MoviePage"
/**
 * TanStack Router route module for movie.$movieId. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

//@ts-ignore
export const Route = createFileRoute("/movie/$movieId")({
  component: MoviePage,
})
