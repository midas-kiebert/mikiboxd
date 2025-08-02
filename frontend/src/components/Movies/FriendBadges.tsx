import { Box } from "@chakra-ui/react";
import type {UserPublic} from "@/client";
import FriendBadge from "@/components/Common/FriendBadge";

type FriendBadgesProps = {
    friends: UserPublic[];
};


const FriendBadges = ({friends}: FriendBadgesProps) => {
    return (
        <Box gap={4}>
            {friends.map((friend) => (
                <FriendBadge
                    key={friend.id}
                    friend={friend}
                />
            ))}
        </Box>
    );
}

export default FriendBadges;
