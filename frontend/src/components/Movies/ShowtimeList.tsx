import { Box, Text } from "@chakra-ui/react";
import type { ShowtimeInMovieLoggedIn } from "@/client";
import CinemaBadge from "../Common/CinemaBadge";

function formatTime(datetime: string): string {
    return new Date(datetime).toLocaleTimeString([], {
        weekday: "short",
        month: "short",
        day: "2-digit",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
    });
  }

type ShowtimeListProps = {
    showtimes: ShowtimeInMovieLoggedIn[];
}

const ShowtimeList = ({ showtimes }: ShowtimeListProps) => {
    return (
        <Box>
            {showtimes.map((s) => (
                <Box
                    maxH={"2em"}
                    key={s.id}
                >
                    <Text
                        fontSize="sm"
                        whiteSpace={"nowrap"}
                        textOverflow={"ellipsis"}
                        overflow={"hidden"}
                    >
                        • {formatTime(s.datetime)}{" "}
                        <Box as="span" color="gray.500" ml={1}>
                            <CinemaBadge cinema={s.cinema} />
                        </Box>
                    </Text>
                </Box>
            ))}
        </Box>
    );
}

export default ShowtimeList;
