import { createFileRoute } from "@tanstack/react-router";
import { Flex } from "@chakra-ui/react";
import Page from "@/components/Common/Page";
import Sidebar from "@/components/Common/Sidebar";
import { useState, useRef, useEffect} from "react";
import { useFetchUsers, type UserFilters } from "@/hooks/useFetchUsers";
import FriendTabs from "@/components/Friends/FriendTabs";

const FriendsPage = () => {
    const limit = 20;
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [searchQuery, setSearchQuery] = useState<string>("");

    const filters: UserFilters = {
        query: searchQuery,
    }

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useFetchUsers({
        limit: limit,
        filters: filters,
    })

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
    })

    return (
        <>
            <Flex>
                <Sidebar/>
            </Flex>
            <Page
                topbarHeight={0}
            >
                <FriendTabs/>
            </Page>
        </>
    );
};

//@ts-ignore
export const Route = createFileRoute("/friends")({
    component: FriendsPage,
});
