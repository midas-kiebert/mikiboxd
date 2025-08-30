import type { ShowtimeLoggedIn } from "@/client";
import { Flex } from "@chakra-ui/react";
import MoviePoster from "../Movies/MoviePoster";
import ShowtimeInfoBox from "./ShowtimeInfoBox";
import DatetimeCard from "./DatetimeCard";
import { useIsMobile } from "@/hooks/useIsMobile";

type ShowtimeCardProps = {
    showtime: ShowtimeLoggedIn;
    highlight?: boolean;
};

const ShowtimeCard = ({ showtime, highlight }: ShowtimeCardProps) => {
    const isMobile = useIsMobile();
    const HEIGHT = isMobile ? 115 : 150;

    return (
        <>
        <Flex
            bg={ highlight ? "green.200" : "gray.50"}
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
                size={`calc(${HEIGHT}px * 0.85)`}
            />
            <ShowtimeInfoBox showtime={showtime} />

        </Flex>
        </>
    );
}

export default ShowtimeCard;
