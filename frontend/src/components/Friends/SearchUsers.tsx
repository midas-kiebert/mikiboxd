import { Box, Heading } from '@chakra-ui/react';
import { useRef } from 'react';
import { useFetchUsers, type UserFilters } from 'shared/hooks/useFetchUsers';
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
            <Heading as="h2" size="lg" mb={4} ml={2}>
                All Users
            </Heading>
            {data?.pages.flat().map((user) => (
                <UserCard
                    key={user.id}
                    user={user}
                />
            ))}
            <div ref={loadMoreRef} />
        </Box>
    );
}

export default SearchUsers;
