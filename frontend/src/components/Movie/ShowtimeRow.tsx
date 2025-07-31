import { Flex, Text, HStack, IconButton, Link } from "@chakra-ui/react";
import CinemaBadge from "../Common/CinemaBadge";
import FriendBadge from "../Common/FriendBadge";
import { FaTicket } from "react-icons/fa6";

import type { ShowtimeInMovieLoggedIn } from "@/client";

type ShowtimeRowProps = {
    showtime: ShowtimeInMovieLoggedIn;
    onToggle: () => void;
}

export function ShowtimeRow({ showtime, onToggle }: ShowtimeRowProps) {
    // unpack showtime data
    const {datetime, cinema, friends_going, going} = showtime;

    // Format time as "7:30 PM"
    const formattedTime = new Date(datetime).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
    });

    return (
        <Flex
            align="center"
            justify="space-between"
            py={1}
            borderBottom="1px solid"
            borderColor="gray.200"
            bg={going ? "green.200" : "white"}
            _hover={{ bg: going ? "green.200" : "gray.50" }}
            onClick={onToggle}
            transition="background 0.2s ease"
        >
            <Link
                href={showtime.ticket_link ?? ""}
                target="_blank"
            >
                <IconButton
                    rel="noopener noreferrer"
                    size="sm"
                    mx={4}
                >
                    <FaTicket />
                </IconButton>
            </Link>
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
        </Flex>
    );
}

export default ShowtimeRow;
