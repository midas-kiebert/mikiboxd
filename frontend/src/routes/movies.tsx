import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import Movies from "@/components/Movies/Movies";
import { useState, useEffect, useRef } from "react";
import SearchBar from "@/components/Movies/SearchBar";
import WatchlistToggle from "@/components/Movies/WatchlistToggle";
import { useFetchMovies } from "@/hooks/useFetchMovies";
import { useDebounce } from "use-debounce";
import type { MovieFilters } from "@/hooks/useFetchMovies";


const MoviesPage = () => {
    const limit = 10;
    const [snapshotTime] = useState(() => new Date().toISOString());
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const search = useSearch({ from: "/movies" });
    //@ts-ignore
    const [searchQuery, setSearchQuery] = useState<string>(search.query ?? "");
    const [debouncedSearchQuery] = useDebounce(searchQuery, 250);
    const [debouncedUrlQuery] = useDebounce(searchQuery, 400);
    const [watchlistOnly, setWatchlistOnly] = useState<boolean>(search.watchlistOnly);

    const queryClient = useQueryClient();
    useEffect(() => {
        queryClient.removeQueries({ queryKey: ["movies"] });
      }, [watchlistOnly, debouncedSearchQuery]);


    const navigate = useNavigate();


    useEffect(() => {
            navigate({
                //@ts-ignore
                search: (prev) => ({
                    ...prev,
                    query: debouncedUrlQuery,
                    watchlistOnly: watchlistOnly,
                }),
                replace: true
            })
    }, [debouncedUrlQuery, watchlistOnly, navigate]);

    const filters: MovieFilters = {
        query: debouncedSearchQuery,
        watchlistOnly: watchlistOnly,
    };

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useFetchMovies({
        limit: limit,
        snapshotTime,
        filters,
    });

    useEffect(() => {
        if (!hasNextPage || isFetchingNextPage) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    fetchNextPage();
                }
            },
            {
                rootMargin: "200px",
            }
        );

        const el = loadMoreRef.current;
        if (el) observer.observe(el);

        return () => {
            if (el) observer.unobserve(el);
        };
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    return (
        <>
            <SearchBar query={searchQuery} setQuery={setSearchQuery}/>
            <WatchlistToggle
                watchlistOnly={watchlistOnly}
                setWatchlistOnly={setWatchlistOnly}
            />
            <Movies
                key={JSON.stringify(filters)}
                movies={data?.pages.flat() || []}
            />
            {hasNextPage && (
                <div ref={loadMoreRef} style={{ height: "1px" }} />
            )}
            {isFetchingNextPage && (
                <div style={{ textAlign: "center", padding: "20px" }}>
                    Loading more movies...
                </div>
            )}
        </>
    );
};

//@ts-ignore
export const Route = createFileRoute("/movies")({
    component: MoviesPage,
    validateSearch: (search) => ({
        query: search.query ?? "",
        watchlistOnly: search.watchlistOnly ? true : false,
    }),
});
