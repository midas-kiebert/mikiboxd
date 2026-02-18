/**
 * Friends feature component: Sent Requests.
 */
import { Box, Heading } from '@chakra-ui/react';
import { useFetchSentRequests } from 'shared/hooks/useFetchSentRequests';
import UserCard from './UserCard';


const SentRequests = () => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const {
        data : requests,
    } = useFetchSentRequests();

    // Render/output using the state and derived values prepared above.
    return (
        <Box>
            { requests?.length! > 0 && (
                <Heading as="h2" size="lg" mb={4} ml={2}>
                    Requests Sent
                </Heading>
                )
            }
            {requests?.map((user) => (
                <UserCard
                    key={user.id}
                    user={user}
                />
            ))}
        </Box>
    );
}

export default SentRequests;
