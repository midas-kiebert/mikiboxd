import { Box } from "@chakra-ui/react";
import type {UserPublic} from "@/client";
import FriendBadge from "@/components/Common/FriendBadge";
import { useIsMobile } from "@/hooks/useIsMobile";

type FriendBadgesProps = {
    friends: UserPublic[];
};


const FriendBadges = ({friends}: FriendBadgesProps) => {
    const isMobile = useIsMobile();
    return (
        <Box gap={4}>
            {friends.map((friend) => (
                <FriendBadge
                    key={friend.id}
                    friend={friend}
                    size={isMobile ? "xs" : "sm"}
                />
            ))}
        </Box>
    );
}

export default FriendBadges;
