/**
 * Shared web layout/presentation component: User Menu.
 */
import { Box, Button, Flex, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"
import { FaUserAstronaut } from "react-icons/fa"
import { FiLogOut, FiUser } from "react-icons/fi"
import { useNavigate } from "@tanstack/react-router"

import useAuth from "shared/hooks/useAuth"
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../ui/menu"

const UserMenu = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const navigate = useNavigate()
  // Data hooks keep this module synced with backend data and shared cache state.
  const { user, logout } = useAuth(
    () => navigate({ to: "/" }), // onLoginSuccess
    () => navigate({ to: "/login" }) // onLogout
  )

  const handleLogout = async () => {
    await logout()
  }

  // Render/output using the state and derived values prepared above.
  return (
    <>
      {/* Desktop */}
      <Flex>
        <MenuRoot>
          <MenuTrigger asChild p={2}>
            <Button data-testid="user-menu" variant="solid" maxW="sm" truncate>
              <FaUserAstronaut fontSize="18" />
              <Text
                display={{ base: "none", md: "inline" }}
              >
                {user?.display_name || "User"}
              </Text>
            </Button>
          </MenuTrigger>

          <MenuContent>
            <Link to="/settings">
              <MenuItem
                closeOnSelect
                value="user-settings"
                gap={2}
                py={2}
                style={{ cursor: "pointer" }}
              >
                <FiUser fontSize="18px" />
                <Box flex="1">My Profile</Box>
              </MenuItem>
            </Link>

            <MenuItem
              value="logout"
              gap={2}
              py={2}
              onClick={handleLogout}
              style={{ cursor: "pointer" }}
            >
              <FiLogOut />
              Log Out
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </Flex>
    </>
  )
}

export default UserMenu
