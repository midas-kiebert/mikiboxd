/**
 * Single-movie detail feature component: Showtime Row.
 */
import { Flex, HStack, IconButton, Link, Text } from "@chakra-ui/react"
import { FaTicket } from "react-icons/fa6"
import CinemaBadge from "../Common/CinemaBadge"

import type { ShowtimeInMovieLoggedIn } from "shared"

type ShowtimeRowProps = {
  showtime: ShowtimeInMovieLoggedIn
  onOpen: (showtime: ShowtimeInMovieLoggedIn) => void
}

export function ShowtimeRow({ showtime, onOpen }: ShowtimeRowProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  // unpack showtime data
  const { datetime, cinema, going } = showtime

  // Format time as "7:30 PM"
  const formattedTime = new Date(datetime).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  })

  // const formattedDate = new Date(datetime).toLocaleDateString(undefined, {
  //     year: "numeric",
  //     month: "long",
  //     day: "numeric",
  // });

  return (
    <Flex
      align="center"
      justify="space-between"
      py={1}
      borderBottom="1px solid"
      borderColor="gray.200"
      bg={
        going === "GOING"
          ? "green.300"
          : going === "INTERESTED"
            ? "orange.300"
            : "white"
      }
      _hover={{
        bg:
          going === "GOING"
            ? "green.200"
            : going === "INTERESTED"
              ? "orange.200"
              : "gray.50",
      }}
      transition="background 0.2s ease"
      onClick={() => onOpen(showtime)}
      cursor={"pointer"}
    >
      <Link
        href={showtime.ticket_link ?? ""}
        target="_blank"
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton rel="noopener noreferrer" size="sm" mx={4}>
          <FaTicket />
        </IconButton>
      </Link>
      <HStack minW="300px" flexShrink={0}>
        <Text fontWeight="semibold" fontSize="md" minW="60px">
          {formattedTime}
        </Text>

        <CinemaBadge cinema={cinema} />
      </HStack>
      <Flex flex="1" />
    </Flex>
  )
}

export default ShowtimeRow
