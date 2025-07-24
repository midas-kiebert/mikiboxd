import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import Movies from "@/components/Movies/Movies";
import { useState, useEffect, useRef } from "react";
import { useFetchMovies } from "@/hooks/useFetchMovies";
import { useDebounce } from "use-debounce";
import MoviesTopBar from "@/components/Movies/MoviesTopBar";
import type { MovieFilters } from "@/hooks/useFetchMovies";
import Sidebar from "@/components/Common/Sidebar";
import { Flex } from "@chakra-ui/react";
import Page from "@/components/Common/Page";

const MoviesPage = () => {
    const limit = 10;
    const [snapshotTime] = useState(() => new Date().toISOString());
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const search = useSearch({ from: "/movies" });
    //@ts-ignore
    const [searchQuery, setSearchQuery] = useState<string>(search.query ?? "");
    const [debouncedSearchQuery] = useDebounce(searchQuery, 250);
    const [watchlistOnly, setWatchlistOnly] = useState<boolean>(search.watchlistOnly);

    const navigate = useNavigate();


    useEffect(() => {
        const isSame = search.query === debouncedSearchQuery &&
                       search.watchlistOnly === watchlistOnly;
        if (isSame) return;
        navigate({
            //@ts-ignore
            search: (prev) => ({
                ...prev,
                query: debouncedSearchQuery,
                watchlistOnly: watchlistOnly,
            }),
            replace: true
        })
    }, [debouncedSearchQuery, watchlistOnly, navigate]);

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
            <Flex>
                <Sidebar/>
                <MoviesTopBar
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    watchlistOnly={watchlistOnly}
                    setWatchlistOnly={setWatchlistOnly}
                />
            </Flex>
            <Page>
                <Movies
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
            </Page>
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
