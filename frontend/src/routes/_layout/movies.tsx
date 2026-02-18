/**
 * TanStack Router route module for movies. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router";

import MoviesPage from "@/components/Movies/MoviesPage";

//@ts-ignore
export const Route = createFileRoute("/_layout/movies")({
    // component: MainShowtimesPage,
    component: MoviesPage,
    validateSearch: (search) => ({
        query: search.query ?? "",
        watchlistOnly: search.watchlistOnly ? true : false,
        days: (() => {
            if (!search.days) return []; // no days selected
            return Array.isArray(search.days) ? search.days : [search.days];
          })(),
    }),
});
