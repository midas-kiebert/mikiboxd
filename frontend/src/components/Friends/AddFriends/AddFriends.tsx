import { Box } from '@chakra-ui/react';
import { useRef, useState } from 'react';
import { useFetchUsers, type UserFilters } from '@/hooks/useFetchUsers';
import useInfiniteScroll from '@/hooks/useInfiniteScroll';
import SearchBar from '@/components/Common/SearchBar';

const AddFriends = () => {
    const limit = 20;
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [searchQuery, setSearchQuery] = useState<string>("");

    const filters: UserFilters = {
        query: searchQuery,
    };

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useFetchUsers({
        limit: limit,
        filters: filters,
    });

    useInfiniteScroll({
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        loadMoreRef,
        rootMargin: "200px",
    });



    return (
        <Box>
            <SearchBar
                query={searchQuery}
                setQuery={setSearchQuery}
                placeholder="Search users..."
            />
            <Box mt={4}>
                {data?.pages.map((page, index) => (
                    <Box key={index}>
                        {page.map(user => (
                            <Box key={user.id} p={2} borderBottom="1px solid #ccc">
                                {user.display_name} ({user.email})
                            </Box>
                        ))}
                    </Box>
                ))}
            </Box>
            <div ref={loadMoreRef} />
        </Box>
    );
}

export default AddFriends;
