import { Box, Grid } from "@chakra-ui/react";
import { FiFilm, FiHome, FiSettings } from "react-icons/fi"
import { FaUserFriends } from "react-icons/fa"
import { FaRegCalendar } from "react-icons/fa6";
import { Link as RouterLink } from "@tanstack/react-router"

const items = [
    { icon: FiSettings, title: "User Settings", path: "/settings" },
    { icon: FaRegCalendar, title: "Agenda", path: "/me/showtimes" },
    { icon: FiHome, title: "Dashboard", path: "/" },
    { icon: FiFilm, title: "Movies", path: "/movies" },
    { icon: FaUserFriends, title: "Friends", path: "/friends" },
]

const BottomNavBar = () => {
    const listItems = items.map(({ icon: Icon, title, path }) => (
        <RouterLink key={title} to={path} style={{ width: "100%", height: "100%" }}>
            <Box
                key={title}
                width="100%"
                height="100%"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Icon size={"20px"}/>
            </Box>
        </RouterLink>
    ))

    return (
        <Box
            position="fixed"
            bg="gray.100"
            bottom={0}
            zIndex={10}
            // minW="xs"
            width={"100%"}
            h="60px"
            p={4}
            >
            <Grid
                templateColumns="repeat(5, 1fr)"
                gap={4}
                height="100%"
                alignItems="center"
                >
                {listItems}
            </Grid>
        </Box>
    );
}

export default BottomNavBar;
