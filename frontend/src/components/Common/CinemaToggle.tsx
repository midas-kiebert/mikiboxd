// import Badge from "@/components/Common/Badge";
import { CinemaPublic } from "shared";
import CinemaBadge from "./CinemaBadge";

interface CinemaToggleProps {
    cinema: CinemaPublic;
    enabled: boolean;
    handleToggle: (cinemaId: number) => void;
}

const CinemaToggle = ({ cinema, enabled, handleToggle } : CinemaToggleProps) => {

    // Read flow: prepare derived values/handlers first, then return component JSX.
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
