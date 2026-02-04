import { useState, useRef } from "react";
import { useFetchMainPageShowtimes } from "shared/hooks/useFetchMainPageShowtimes"
import { Center, Spinner } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import useInfiniteScroll from "@/hooks/useInfiniteScroll";
import { DateTime } from "luxon";
import { Showtimes } from "@/components/Showtimes/Showtimes";


const MainShowtimesPage = () => {
    const limit = 20;
    const [snapshotTime] = useState(() => DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

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
