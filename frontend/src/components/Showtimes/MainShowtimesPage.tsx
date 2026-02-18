/**
 * Showtimes feature component: Main Showtimes Page.
 */
import { useState, useRef } from "react";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes"
import type { GoingStatus } from "shared";
import { Center, Spinner } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import useInfiniteScroll from "@/hooks/useInfiniteScroll";
import { DateTime } from "luxon";
import { Showtimes } from "@/components/Showtimes/Showtimes";

const DEFAULT_SELECTED_STATUSES: GoingStatus[] = ["GOING", "INTERESTED"];

const MainShowtimesPage = () => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const limit = 20;
    const [snapshotTime] = useState(() => DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    // Default to the "Interested" feed (going + interested) to avoid fetching the full showtimes catalogue.
    const selectedStatuses = DEFAULT_SELECTED_STATUSES;

    // Data hooks keep this module synced with backend data and shared cache state.
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isFetching,
    } = useFetchMainPageShowtimes({
        limit: limit,
        snapshotTime,
        filters: { selectedStatuses },
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
            <Center h="100vh">
                <Spinner size="xl" />
            </Center>
        );
    }

    // Render/output using the state and derived values prepared above.
    return (
        <Page>
            <Showtimes showtimes={showtimes}/>
            {hasNextPage && (
                <div ref={loadMoreRef} style={{ height: "1px" }} />
            )}
            {isFetchingNextPage && (
                <div style={{ textAlign: "center", padding: "20px" }}>
                    Loading more showtimes...
                </div>
            )}
        </Page>
    );
};

export default MainShowtimesPage;
