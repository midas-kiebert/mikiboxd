/**
 * Showtimes feature component: My Showtimes Page.
 */
import { useState, useRef } from "react";
import { useFetchMyShowtimes } from "shared/hooks/useFetchMyShowtimes";
import { Spinner, Center } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import useInfiniteScroll from "@/hooks/useInfiniteScroll";
import { DateTime } from "luxon";
import { Showtimes } from "@/components/Showtimes/Showtimes";

const MyShowtimesPage = () => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const limit = 20;
    const [snapshotTime] = useState(() => DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    // Data hooks keep this module synced with backend data and shared cache state.
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isFetching,
    } = useFetchMyShowtimes({
        limit: limit,
        snapshotTime,
    });

    useInfiniteScroll({
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        loadMoreRef,
        rootMargin: "200px",
    });

    const showtimes = data?.pages.flat() ?? [];

    if ((isLoading || isFetching) && !isFetchingNextPage) {
        return (
            <>
                <Center h="100vh">
                    <Spinner size="xl" />
                </Center>
            </>
        );
    }

    // Render/output using the state and derived values prepared above.
    return (
        <>
            <Page>
                <h1>My Showtimes</h1>
                <Showtimes showtimes={showtimes}/>
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

export default MyShowtimesPage;
