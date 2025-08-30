// import Badge from "@/components/Common/Badge";
import { CinemaPublic } from "@/client";
import { Badge } from "@chakra-ui/react";
import { useIsMobile } from "@/hooks/useIsMobile";

interface CinemaBadgeProps extends React.ComponentProps<typeof Badge> {
    cinema: CinemaPublic;
    enabled?: boolean;
}

const CinemaBadge = ({ cinema, enabled = true, ...rest } : CinemaBadgeProps) => {
    const name = cinema.name;
    const color = cinema.badge_bg_color || "gray.500";
    const isMobile = useIsMobile();

    return (
        <Badge
            m={0.5}
            ml={isMobile ? 0 : 0.5}
            variant={"surface"}
            colorPalette={enabled ? color : "grey"}
            size={isMobile ? "xs" : "sm"}
            {...rest}
        >
            {name}
        </Badge>
    );
};

export default CinemaBadge;
