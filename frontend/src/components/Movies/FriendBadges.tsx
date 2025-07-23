import { Box, Badge } from "@chakra-ui/react";
import type {UserPublic} from "@/client";

type FriendBadgesProps = {
    friends: UserPublic[];
};


const FriendBadges = ({friends}: FriendBadgesProps) => {
    return (
        <Box>
            {friends.map((friend) => (
                <Badge
                    key={friend.id}
                    colorPalette={"gray"}
                    variant={"solid"}
                >
                    {friend.display_name}
                </Badge>
            ))}
        </Box>
    );
}

export default FriendBadges;
