import { Box, Heading } from '@chakra-ui/react';
import { useFetchFriends } from 'shared/hooks/useFetchFriends';
import UserCard from './UserCard';


const Friends = () => {
    const {
        data : friends,
    } = useFetchFriends();

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
