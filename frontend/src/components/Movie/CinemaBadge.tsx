import Badge from "@/components/Common/Badge";
import { CinemaPublic } from "@/client";

interface CinemaBadgeProps {
    cinema: CinemaPublic;
}

const CinemaBadge = ({ cinema } : CinemaBadgeProps) => {
    const name = cinema.name;
    const color = cinema.badge_bg_color || "gray.500";
    const textColor = cinema.badge_text_color || "white";
    const url = cinema.url || "";

    return (
        <Badge
            text={name}
            bgColor={color}
            textColor={textColor}
            url={url}
            hoverColor={color}
            textSize="12px"
        />
    );
};

export default CinemaBadge;