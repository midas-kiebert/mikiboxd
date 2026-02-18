/**
 * Showtimes feature component: Showtime Card.
 */
import type { GoingStatus, ShowtimeLoggedIn } from "shared";
import { Flex } from "@chakra-ui/react";
import MoviePoster from "../Movies/MoviePoster";
import ShowtimeInfoBox from "./ShowtimeInfoBox";
import DatetimeCard from "./DatetimeCard";
import { useIsMobile } from "@/hooks/useIsMobile";

type ShowtimeCardProps = {
    showtime: ShowtimeLoggedIn;
    going_status: GoingStatus;
};

const ShowtimeCard = ({ showtime, going_status }: ShowtimeCardProps) => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const isMobile = useIsMobile();
    const HEIGHT = isMobile ? 115 : 150;

    // Render/output using the state and derived values prepared above.
    return (
        <>
        <Flex
            bg={ going_status == "GOING" ? "green.200" : going_status == "INTERESTED" ? "orange.200" : "gray.50"}
            borderBottom={"1px solid"}
            borderColor={"gray.200"}
            py={3}
            px={2}
            height={HEIGHT}
            gap={isMobile ? 1 : 2}
        >
            <DatetimeCard showtime={showtime}></DatetimeCard>
            <MoviePoster
                movie={showtime.movie}
                size={{base: `calc(${HEIGHT}px * 0.85)`, md: `calc(${HEIGHT}px * 0.85)`}}
            />
            <ShowtimeInfoBox showtime={showtime} />

        </Flex>
        </>
    );
}

export default ShowtimeCard;
