import { Box, Badge } from "@chakra-ui/react";
import CinemaBadge from "@/components/Common/CinemaBadge";
import type { CinemaPublic } from "@/client";

type CinemaBadgesProps = {
    cinemas: CinemaPublic[];
};

const CinemaBadges = ({ cinemas }: CinemaBadgesProps) => {
    return (
        <Box>
            {cinemas.map((cinema) => (
                <CinemaBadge
                    key={cinema.id}
                    cinema={cinema}
                />
            ))}
        </Box>
    );
};

export default CinemaBadges;
