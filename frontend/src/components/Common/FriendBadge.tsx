import { Badge } from "@chakra-ui/react";
import { Responsive } from "@/types";
import { Link } from "@tanstack/react-router";
import type { UserPublic } from "shared";
import { Route as ShowtimesRoute } from "@/routes/_layout/$userId/showtimes";

interface FriendBadgeProps {
    friend: UserPublic;
    variant?: "surface" | "plain";
    size?: Responsive<"xs" | "sm" | "md" | "lg">;
    colorPalette?: string;
}

const FriendBadge = ({
    friend,
    variant="surface",
    size="sm",
    colorPalette="gray"
} : FriendBadgeProps) => {
    return (
        <Link
            to={ShowtimesRoute.to}
            params={{ userId: `${friend.id}` }}
            style={{ display: "inline-block" }}
            onClick={(e) => e.stopPropagation()}
        >
            <Badge
                key={friend.id}
                colorPalette={colorPalette}
                variant={variant}
                mr={1}
                mb={0.5}
                size={size}
            >
                {friend.display_name}
            </Badge>
        </Link>
    );
};

export default FriendBadge;
