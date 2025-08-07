// import Badge from "@/components/Common/Badge";
import { CinemaPublic } from "@/client";
import { Badge } from "@chakra-ui/react";

interface CinemaBadgeProps extends React.ComponentProps<typeof Badge> {
    cinema: CinemaPublic;
    enabled?: boolean;
}

const CinemaBadge = ({ cinema, enabled = true, ...rest } : CinemaBadgeProps) => {
    const name = cinema.name;
    const color = cinema.badge_bg_color || "gray.500";

    return (
        <Badge
            m={0.5}
            variant={"surface"}
            colorPalette={enabled ? color : "grey"}
            size={"sm"}
            {...rest}
        >
            {name}
        </Badge>
    );
};

export default CinemaBadge;
