/**
 * Movies list feature component: Friend Badges.
 */
import { Box } from "@chakra-ui/react";
import type {UserPublic} from "shared";
import FriendBadge from "@/components/Common/FriendBadge";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { GoingStatus } from "shared";

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
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const isMobile = useIsMobile();
    // Render/output using the state and derived values prepared above.
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
