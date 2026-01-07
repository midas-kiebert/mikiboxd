import { Box } from "@chakra-ui/react";
import type {UserPublic} from "@/client";
import FriendBadge from "@/components/Common/FriendBadge";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { GoingStatus } from "@/client";

type FriendBadgesProps = {
    friends: UserPublic[];
    goingStatus: GoingStatus;
};

const goingColor : Record<GoingStatus, string> = {
    GOING: "green",
    INTERESTED: "orange",
    NOT_GOING: "gray",
};


const FriendBadges = ({friends, goingStatus}: FriendBadgesProps) => {
    const isMobile = useIsMobile();
    return (
        <Box gap={4}>
            {friends.map((friend) => (
                <FriendBadge
                    key={friend.id}
                    friend={friend}
                    size={isMobile ? "xs" : "sm"}
                    colorPalette={goingColor[goingStatus]}
                />
            ))}
        </Box>
    );
}

export default FriendBadges;
