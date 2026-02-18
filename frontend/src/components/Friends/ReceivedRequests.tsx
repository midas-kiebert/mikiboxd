/**
 * Friends feature component: Received Requests.
 */
import { Box, Heading } from '@chakra-ui/react';
import { useFetchReceivedRequests } from 'shared/hooks/useFetchReceivedRequests';
import UserCard from './UserCard';


const ReceivedRequests = () => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const {
        data : requests,
    } = useFetchReceivedRequests();

    // Render/output using the state and derived values prepared above.
    return (
        <Box>
            { requests?.length! > 0 && (
                <Heading as="h2" size="lg" mb={4} ml={2}>
                    Requests Received
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

export default ReceivedRequests;
