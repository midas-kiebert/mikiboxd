import { Flex, Text, HStack, Button, Skeleton } from "@chakra-ui/react";
import CinemaBadge from "./CinemaBadge";
import FriendBadge from "../Common/FriendBadge"

import type { ShowtimeInMoviePublic } from "@/client";
import ShowtimeSelector from "./ShowtimeSelector";
import useIsShowtimeSelected from "@/hooks/useIsShowtimeSelected";

type ShowtimeRowProps = {
    showtime: ShowtimeInMoviePublic;
}


export function ShowtimeRow({ showtime }: ShowtimeRowProps) {
    // unpack showtime data
    const {datetime, cinema, friends_going} = showtime;

    // Format time as "7:30 PM"
    const formattedTime = new Date(datetime).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
    });

    const { isSelected, isLoading } = useIsShowtimeSelected(showtime.id);
    if (isLoading) {
        return <Skeleton height="50px" width="100%" borderRadius="md" />;
    }


    return (
        <Flex
            align="center"
            justify="space-between"
            // py={2}
            px={4}
            borderBottom="1px solid"
            borderColor="gray.200"
            bg={isSelected ? "blue.100" : "white"}
        >
            {/* Left side: time + cinema badge */}
            <HStack minW="300px" flexShrink={0}>
                <Text fontWeight="semibold" fontSize="md" minW="60px">
                    {formattedTime}
                </Text>

                <CinemaBadge cinema={cinema} />
            </HStack>

            {/* Middle: friend badges */}
            <HStack px={5} flex="1" justify="left" overflowX="auto" minW={0}>
                {friends_going?.length === 0 ? (
                    <Text fontSize="sm" color="gray.500" whiteSpace="nowrap">
                        No friends going
                    </Text>
                ) : (
                    <>
                        <Text>Friends Going:</Text>
                        {friends_going?.map(({ id, display_name }) => (
                            <FriendBadge
                                key={id}
                                display_name={display_name? display_name : ""}
                                url={"/@"}
                            />
                        ))}
                    </>
                )}
            </HStack>

            {/* Right side: ticket link + toggle */}
            <HStack minW="180px" flexShrink={0} justifyContent="flex-end" px={10}>
                <Button
                    as="a"
                    rel="noopener noreferrer"
                    size="sm"
                    colorScheme="blue"
                >
                    Buy Ticket
                </Button>



                <ShowtimeSelector id={showtime.id}/>
            </HStack>
        </Flex>
    );
}

export default ShowtimeRow;
