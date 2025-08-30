import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import { FiFilm, FiHome, FiSettings } from "react-icons/fi"
import { FaUserFriends } from "react-icons/fa"
import { FaRegCalendar } from "react-icons/fa6";

const items = [
  { icon: FiHome, title: "Dashboard", path: "/" },
  { icon: FiFilm, title: "Movies", path: "/movies" },
  { icon: FaRegCalendar, title: "Agenda", path: "/me/showtimes" },
  { icon: FaUserFriends, title: "Friends", path: "/friends" },
  { icon: FiSettings, title: "User Settings", path: "/settings" },
]

interface SidebarItemsProps {
  onClose?: () => void
}


const SidebarItems = ({ onClose }: SidebarItemsProps) => {

  const listItems = items.map(({ icon, title, path }) => (
    <RouterLink key={title} to={path} onClick={onClose}>
      <Flex
        gap={4}
        px={4}
        py={2}
        _hover={{
          background: "gray.subtle",
        }}
        alignItems="center"
        fontSize="sm"
      >
        <Icon as={icon} alignSelf="center" />
        <Text ml={2}>{title}</Text>
      </Flex>
    </RouterLink>
  ))

  return (
    <>
      <Text fontSize="xs" px={4} py={2} fontWeight="bold">
        Menu
      </Text>
      <Box>{listItems}</Box>
    </>
  )
}

export default SidebarItems
