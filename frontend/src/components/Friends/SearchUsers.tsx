import { Box } from '@chakra-ui/react';
import { useRef } from 'react';
import { useFetchUsers, type UserFilters } from '@/hooks/useFetchUsers';
import useInfiniteScroll from '@/hooks/useInfiniteScroll';
import UserCard from './UserCard';

type SearchUsersProps = {
    query: string;
};

const SearchUsers = (
    { query }: SearchUsersProps
) => {
    const limit = 20;
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const filters: UserFilters = {
        query: query,
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
            <Box
                mt={4}
                maxW={ { base: '100%', md: '800px' }}
            >
                {data?.pages.flat().map((user) => (
                    <UserCard
                        key={user.id}
                        user={user}
                    />
                ))}
            </Box>
            <div ref={loadMoreRef} />
        </Box>
    );
}

export default SearchUsers;
