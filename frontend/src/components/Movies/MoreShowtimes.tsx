import {Box, Text} from "@chakra-ui/react";
import type { ShowtimeInMoviePublic } from "@/client";


function formatDate(datetime: string): string {
    return new Date(datetime).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "2-digit",
    });
}


type MoreShowtimesProps = {
    lastShowtime?: string | null;
    additional_showtime_count: number;
};

const MoreShowtimes = ({ lastShowtime, additional_showtime_count }: MoreShowtimesProps) => {
    return (
        <Box
            maxH={"2em"}
        >
            <Text
                color={"gray.500"}
            >
                {lastShowtime && additional_showtime_count > 0 ? (
                    <>
                        +{additional_showtime_count}
                        {" more (last on "}
                        {formatDate(lastShowtime)}
                        {")"}
                    </>
                ) : (
                    ""
                )}
            </Text>
        </Box>
    );
};

export default MoreShowtimes;
