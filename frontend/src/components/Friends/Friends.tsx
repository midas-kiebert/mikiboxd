/**
 * Friends feature component: Friends.
 */
import { Box, Heading } from '@chakra-ui/react';
import { useFetchFriends } from 'shared/hooks/useFetchFriends';
import UserCard from './UserCard';


const Friends = () => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const {
        data : friends,
    } = useFetchFriends();

    // Render/output using the state and derived values prepared above.
    return (
        <Box>
            { friends?.length! > 0 && (
                <Heading as="h2" size="lg" mb={4} ml={2}>
                    Friends
                </Heading>
                )
            }
            {friends?.map((friend) => (
                <UserCard
                    key={friend.id}
                    user={friend}
                />
            ))}
        </Box>
    );
}

export default Friends;
