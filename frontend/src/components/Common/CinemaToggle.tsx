// import Badge from "@/components/Common/Badge";
import { CinemaPublic } from "@/client";
import CinemaBadge from "./CinemaBadge";

interface CinemaToggleProps {
    cinema: CinemaPublic;
    enabled: boolean;
    handleToggle: (cinemaId: number) => void;
}

const CinemaToggle = ({ cinema, enabled, handleToggle } : CinemaToggleProps) => {

    return (
            <CinemaBadge
                cinema={cinema}
                enabled={enabled}
                size={"md"}
                onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(cinema.id);
                }}
            />
    );
}

export default CinemaToggle;
