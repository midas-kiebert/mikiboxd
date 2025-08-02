import { createFileRoute } from "@tanstack/react-router";

import MoviesPage from "@/components/Movies/MoviesPage";

//@ts-ignore
export const Route = createFileRoute("/movies")({
    component: MoviesPage,
    validateSearch: (search) => ({
        query: search.query ?? "",
        watchlistOnly: search.watchlistOnly ? true : false,
    }),
});
