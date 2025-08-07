// import Badge from "@/components/Common/Badge";
import { CinemaPublic } from "@/client";
import CinemaBadge from "./CinemaBadge";
import { useState } from "react";

interface CinemaToggleProps {
    cinema: CinemaPublic;
    enabled: boolean;
    handleToggle: (cinemaId: number, enabled: boolean) => void;
}

const CinemaToggle = ({ cinema, enabled, handleToggle } : CinemaToggleProps) => {
    const [isEnabled, setIsEnabled] = useState(enabled);

    return (
            <CinemaBadge
                cinema={cinema}
                enabled={isEnabled}
                size={"md"}
                onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(cinema.id, !isEnabled);
                    setIsEnabled(!isEnabled);
                }}
            />
    );
}

export default CinemaToggle;
