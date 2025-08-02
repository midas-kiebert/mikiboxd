import { useState, useRef } from "react";
import { useFetchMyShowtimes } from "@/hooks/useFetchMyShowtimes";
import Sidebar from "@/components/Common/Sidebar";
import { Flex } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import useInfiniteScroll from "@/hooks/useInfiniteScroll";
import { DateTime } from "luxon";
import { Showtimes } from "@/components/Showtimes/Showtimes";

const MyShowtimesPage = () => {
    const limit = 20;
    const [snapshotTime] = useState(() => DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"));
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
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

    return (
        <>
            <Flex>
                <Sidebar/>
            </Flex>
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
        </>
    );
};

export default MyShowtimesPage;
