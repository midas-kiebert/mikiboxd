import { Badge } from "@chakra-ui/react";
import { Link } from "@tanstack/react-router";
import type { UserPublic } from "@/client";
import { Route as ShowtimesRoute } from "@/routes/users/$userId/showtimes";

interface FriendBadgeProps {
    friend: UserPublic;
}

const CinemaBadge = ({ friend } : FriendBadgeProps) => {

    return (
        <Link
            to={ShowtimesRoute.to}
            params={{ userId: `${friend.id}` }}
            style={{ display: "inline-block" }}
            onClick={(e) => e.stopPropagation()}
        >
            <Badge
                key={friend.id}
                colorPalette={"gray"}
                variant="surface"
                mr={1}
                mb={0.5}
            >
                {friend.display_name}
            </Badge>
        </Link>
    );
};

export default CinemaBadge;
