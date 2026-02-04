import { useSearch, useNavigate } from "@tanstack/react-router";
import Movies from "@/components/Movies/Movies";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient, } from "@tanstack/react-query";
import { MeService } from "shared";
import { useFetchMovies } from "shared/hooks/useFetchMovies";
import { useDebounce } from "use-debounce";
import MoviesTopBar from "@/components/Movies/MoviesTopBar";
import type { MovieFilters } from "shared/hooks/useFetchMovies";
import { Flex, Center, Spinner } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import useInfiniteScroll from "@/hooks/useInfiniteScroll";
import { DateTime } from "luxon";

const MoviesPage = () => {
    const limit = 20;
    const [snapshotTime] = useState(() => DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const search = useSearch({ from: "/_layout/movies" });
    //@ts-ignore
    const [searchQuery, setSearchQuery] = useState<string>(search.query ?? "");
    const [debouncedSearchQuery] = useDebounce(searchQuery, 250);
    const [watchlistOnly, setWatchlistOnly] = useState<boolean>(search.watchlistOnly);
    // Convert URL string days to Date objects for the DayFilter
    const selectedDays = search.days.map(d => DateTime.fromISO(d).toJSDate());

    const handleDaysChange = (days: Date[]) => {
        // Convert Date objects to ISO strings for the URL
        const isoDays = days.map(d => DateTime.fromJSDate(d).toISODate());
        navigate({
            //@ts-ignore
            search: prev => ({
              ...(prev as { query?: string; watchlistOnly?: boolean; days?: string[] }),
              days: isoDays,
            }),
            replace: true,
          });
    };
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
        days: selectedDays.map(d => DateTime.fromJSDate(d).toISODate() || ""),
    };

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isFetching,
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
        rootMargin: "2000px",
    });

    return (
        <>
            <Flex>
                <MoviesTopBar
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    watchlistOnly={watchlistOnly}
                    setWatchlistOnly={setWatchlistOnly}
                    selectedDays={selectedDays}
                    handleDaysChange={handleDaysChange}
                />
            </Flex>
            <Page>
                <Movies
                    movies={data?.pages.flat() || []}
                    isLoading={(isLoading || isFetching) && !isFetchingNextPage}
                />
                {hasNextPage && (
                    <div ref={loadMoreRef} style={{ height: "1px" }} />
                )}
                {isFetchingNextPage && (
                    <Center mt={4}>
                        <Spinner size="lg" />
                    </Center>
                )}
            </Page>
        </>
    );
};

export default MoviesPage;
