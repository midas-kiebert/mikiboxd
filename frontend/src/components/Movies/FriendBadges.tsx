import {Box} from "@chakra-ui/react";
import FriendBadge from "@/components/Common/FriendBadge";
import type {UserPublic} from "@/client";

type FriendBadgesProps = {
    friends: UserPublic[];
};

const FriendBadges = ({friends}: FriendBadgesProps) => {
    return (
        <Box>
            {friends.map((friend) => (
                <FriendBadge
                    key={friend.id}
                    display_name={friend.display_name!}
                    url={"@/"}
                />
            ))}
            <FriendBadge
                display_name={"friends going"}
                url={"@/"}
            />
        </Box>
    );
}

export default FriendBadges;
