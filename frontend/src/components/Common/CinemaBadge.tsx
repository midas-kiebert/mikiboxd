// import Badge from "@/components/Common/Badge";
import { CinemaPublic } from "@/client";
import { Badge } from "@chakra-ui/react";

interface CinemaBadgeProps {
    cinema: CinemaPublic;
}

const CinemaBadge = ({ cinema } : CinemaBadgeProps) => {
    const name = cinema.name;
    const color = cinema.badge_bg_color || "gray.500";
    // const textColor = cinema.badge_text_color || "white";
    // const url = cinema.url || "";

    return (
        <Badge
            m={0.5}
            variant={"surface"}
            colorPalette={color}
            size={"md"}
        >
            {name}
        </Badge>
    );
};

export default CinemaBadge;
