import { useEffect } from "react";

interface InfiniteScrollProps {
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    loadMoreRef: React.RefObject<HTMLDivElement>;
    rootMargin?: string;
}



const useInfiniteScroll = ({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    loadMoreRef,
    rootMargin = "200px",
}: InfiniteScrollProps) => {
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
