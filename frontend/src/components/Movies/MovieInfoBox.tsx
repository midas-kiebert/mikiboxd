import { Box, Text,  } from "@chakra-ui/react";
import MovieTitle from "./MovieTitle";
import { MovieSummaryPublic } from "@/client";
import CinemaBadge from "../Movie/CinemaBadge";
import FriendBadge from "@/components/Common/FriendBadge"



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

function formatDate(datetime: string): string {
    return new Date(datetime).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "2-digit",
    });
}


type MovieInfoBoxProps = {
    movie: MovieSummaryPublic;
};

export default function MovieInfoBox({ movie } : MovieInfoBoxProps) {
    const showtimes = movie.showtimes || [];
    const cinemas = movie.cinemas || [];
    const lastShowtime = movie.last_showtime_datetime || null;
    const total_showtimes = movie.total_showtimes || 0;
    const friends_going = movie.friends_going || [];
    return (
        <Box
            mx={8}
            // bg="blue.200"
            flex="1"
            display={"flex"}
            flexDirection="column"
        >
            <MovieTitle title={movie.title} />
            <Box
                // bg="red.100"
            >
                {cinemas.map((cinema) => (
                    <CinemaBadge
                        key={cinema.id}
                        cinema={cinema}
                    />
                ))}
            </Box>
            <Box
                display={"flex"}
            >
                <Box
                    bg="orange.100"
                    width={"50%"}
                    maxW={"50%"}
                    overflow={"cover"}
                    flex="1"
                    // display={"flex"}
                    height={"100%"}
                    pl={0.5}
                >

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
                                <Box as="span" color="gray.500">
                                    ({s.cinema.name})
                                </Box>
                            </Text>
                        </Box>
                    ))}
                    <Box
                        maxH={"2em"}
                    >
                        <Text
                            color={"gray.500"}
                        >
                            {lastShowtime && total_showtimes > showtimes.length ? (
                                <>
                                    +{total_showtimes - showtimes.length}
                                    {" more (last on "}
                                    {formatDate(lastShowtime)}
                                    {")"}
                                </>
                            ) : (
                                ""
                            )}
                        </Text>
                    </Box>
                </Box>
                <Box>
                    { friends_going.map((friend) => (
                        <FriendBadge
                            key={friend.id}
                            display_name={friend.display_name || ""}
                            url={`/@`}
                        />
                    ))}
                </Box>
            </Box>
        </Box>
    )
}
