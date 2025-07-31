import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import Movies from "@/components/Movies/Movies";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService } from "@/client";
import { useFetchMovies } from "@/hooks/useFetchMovies";
import { useDebounce } from "use-debounce";
import MoviesTopBar from "@/components/Movies/MoviesTopBar";
import type { MovieFilters } from "@/hooks/useFetchMovies";
import Sidebar from "@/components/Common/Sidebar";
import { Flex } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import useInfiniteScroll from "@/hooks/useInfiniteScroll";
import { DateTime } from "luxon";

const MoviesPage = () => {
    const limit = 20;
    const [snapshotTime] = useState(() => DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const search = useSearch({ from: "/movies" });
    //@ts-ignore
    const [searchQuery, setSearchQuery] = useState<string>(search.query ?? "");
    const [debouncedSearchQuery] = useDebounce(searchQuery, 250);
    const [watchlistOnly, setWatchlistOnly] = useState<boolean>(search.watchlistOnly);

    const navigate = useNavigate();

    const queryClient = useQueryClient();

    const { mutate: fetchWatchlist } = useMutation({
        mutationFn: () => MeService.syncWatchlist(),
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['movies']});
        },
    });

    const hasFetched = useRef(false);

    useEffect(() => {
        if (hasFetched.current) return;
        fetchWatchlist();
        hasFetched.current = true;
    }, [])


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

    useInfiniteScroll({
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        loadMoreRef,
        rootMargin: "200px",
    });

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
