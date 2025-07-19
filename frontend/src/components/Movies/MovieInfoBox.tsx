import { Box, VStack, Text,  } from "@chakra-ui/react";
import MovieTitle from "./MovieTitle";
import { MovieSummaryPublic } from "@/client";
import CinemaBadge from "../Movie/CinemaBadge";



function formatTime(datetime: string): string {
    return new Date(datetime).toLocaleTimeString([], {
        month: "short",
        day: "2-digit",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
    });
  }


type MovieInfoBoxProps = {
    movie: MovieSummaryPublic;
};

export default function MovieInfoBox({ movie } : MovieInfoBoxProps) {
    const showtimes = movie.showtimes || [];
    const cinemas = movie.cinemas || [];

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
                // bg="orange.100"
                width={"50%"}
                maxW={"50%"}
                overflow={"cover"}
                px={2}
                flex="1"
                height={"100%"}
            >
                {showtimes.map((s) => (
                    <Box
                        maxH={"2em"}
                    >
                        <Text
                            key={s.id}
                            fontSize="sm"
                            whiteSpace={"nowrap"}
                            textOverflow={"ellipsis"}
                            overflow={"hidden"}
                        >
                            {formatTime(s.datetime)}{" "}
                            <Box as="span" color="gray.500">
                                ({s.cinema.name})
                            </Box>
                        </Text>
                    </Box>
                ))}
            </Box>
        </Box>
    )
}
