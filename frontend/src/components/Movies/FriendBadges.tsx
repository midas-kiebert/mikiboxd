import { Box, Badge } from "@chakra-ui/react";
import type {UserPublic} from "@/client";

type FriendBadgesProps = {
    friends: UserPublic[];
};


const FriendBadges = ({friends}: FriendBadgesProps) => {
    return (
        <Box gap={4}>
            {friends.map((friend) => (
                <Badge
                    key={friend.id}
                    colorPalette={"gray"}
                    variant="surface"
                    mr={1}
                    mb={0.5}
                >
                    {friend.display_name}
                </Badge>
            ))}
        </Box>
    );
}

export default FriendBadges;
