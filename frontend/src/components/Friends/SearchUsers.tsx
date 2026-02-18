/**
 * Friends feature component: Search Users.
 */
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
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const limit = 20;
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const filters: UserFilters = {
        query: query,
    };

    // Data hooks keep this module synced with backend data and shared cache state.
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



    // Render/output using the state and derived values prepared above.
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
