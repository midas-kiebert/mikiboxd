import { Box, Heading } from '@chakra-ui/react';
import { useFetchSentRequests } from '@/hooks/useFetchSentRequests';
import UserCard from './UserCard';


const SentRequests = () => {
    const {
        data : requests,
    } = useFetchSentRequests();

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
