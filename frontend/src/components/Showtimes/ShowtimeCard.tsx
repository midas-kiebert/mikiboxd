import type { ShowtimeLoggedIn } from "@/client";
import { Flex } from "@chakra-ui/react";
import MoviePoster from "../Movies/MoviePoster";
import ShowtimeInfoBox from "./ShowtimeInfoBox";
import DatetimeCard from "./DatetimeCard";

type ShowtimeCardProps = {
    showtime: ShowtimeLoggedIn;
};

const ShowtimeCard = ({ showtime }: ShowtimeCardProps) => {
    const HEIGHT = "150px";

    return (
        <>
        <Flex
            bg={"gray.50"}
            borderBottom={"1px solid"}
            borderColor={"gray.200"}
            py={3}
            px={2}
            height={HEIGHT}
            gap={2}
        >
            <DatetimeCard showtime={showtime}></DatetimeCard>
            <MoviePoster
                movie={showtime.movie}
                size={`calc(${HEIGHT} * 0.85)`}
            />
            <ShowtimeInfoBox showtime={showtime} />

        </Flex>
        </>
    );
}

export default ShowtimeCard;
