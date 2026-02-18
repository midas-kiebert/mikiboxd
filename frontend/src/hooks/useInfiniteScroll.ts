/**
 * Custom web hook for Use Infinite Scroll. It encapsulates reusable stateful behavior.
 */
import { useEffect } from "react";

interface InfiniteScrollProps {
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    loadMoreRef: React.RefObject<HTMLDivElement | null>;
    rootMargin?: string;
}



const useInfiniteScroll = ({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    loadMoreRef,
    rootMargin = "200px",
}: InfiniteScrollProps) => {
    // Read flow: derive reusable behavior first, then expose the hook API.
    useEffect(() => {
        if (!hasNextPage || isFetchingNextPage) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    fetchNextPage();
                }
            },
            {
                rootMargin: rootMargin,
            }
        );

        const el = loadMoreRef.current;
        if (el) observer.observe(el);

        return () => {
            if (el) observer.unobserve(el);
        };
    })
}

export default useInfiniteScroll;
