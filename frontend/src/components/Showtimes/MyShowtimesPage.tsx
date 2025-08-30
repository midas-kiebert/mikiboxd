import { useState, useRef } from "react";
import { useFetchMyShowtimes } from "@/hooks/useFetchMyShowtimes";
import Sidebar from "@/components/Common/Sidebar";
import { Flex, Spinner, Center } from "@chakra-ui/react";
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
                <Flex>
                    <Sidebar/>
                </Flex>
                <Center h="100vh">
                    <Spinner size="xl" />
                </Center>
            </>
        );
    }

    return (
        <>
            <Flex>
                <Sidebar/>
            </Flex>
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
