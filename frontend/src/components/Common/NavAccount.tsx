/**
 * Shared web layout/presentation component: Nav Account.
 *
 * The account chip at the right of the top nav: who you are, and what you can
 * do about it — Settings, Admin for a superuser, and Log out. Settings and Admin
 * used to be tabs; they are about your account rather than places to browse, so
 * they sit here and the tab row is just the app's destinations. "Log out" used
 * to be reachable only from a page's own user menu, which not every page had.
 *
 * A guest gets a sign-in button in the same slot rather than an empty corner —
 * browsing without an account is a supported way to use the site, so the nav
 * has to have something to say to someone using it that way.
 */
import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  FiChevronDown,
  FiLogIn,
  FiLogOut,
  FiSettings,
  FiShield,
  FiUser,
} from "react-icons/fi"

import { useIsSignedIn } from "@/auth/useSession"
import { PersonAvatar } from "@/components/Showtimes/detail/PersonAvatar"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import useAuth from "shared/hooks/useAuth"
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu"

interface NavAccountProps {
  /** Closes the drawer when a menu entry navigates on a phone. */
  onNavigate?: () => void
}

const NavAccount = ({ onNavigate }: NavAccountProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const navigate = useNavigate()
  const isSignedIn = useIsSignedIn()
  // Data hooks keep this module synced with backend data and shared cache state.
  const { user, logout } = useAuth(
    () => navigate({ to: "/", search: defaultFeedParams }), // onLoginSuccess
    // No onLogout: signing out leaves you on the page you were on, as a guest.
  )

  const handleLogout = async () => {
    onNavigate?.()
    await logout()
  }

  if (!isSignedIn) {
    return (
      <Link
        to="/login"
        onClick={onNavigate}
        aria-label="Sign in"
        style={{ display: "block", flexShrink: 0 }}
      >
        <Flex
          align="center"
          gap={2}
          h="40px"
          px={3}
          borderRadius="lg"
          borderWidth="1px"
          borderColor="border"
          bg="bg.panel"
          fontSize="sm"
          fontWeight="semibold"
          color="fg"
          transition="background 120ms ease"
          _hover={{ bg: "bg.subtle" }}
        >
          <Icon as={FiLogIn} boxSize="18px" />
          <Text
            truncate
            display={{ base: "none", sm: "block" }}
            position="relative"
            top="1px"
          >
            Sign in
          </Text>
        </Flex>
      </Link>
    )
  }

  const name = user?.display_name?.trim() || "Your account"
  const email = user?.email ?? ""

  return (
    <MenuRoot positioning={{ placement: "bottom-end" }}>
      <MenuTrigger asChild>
        <Flex
          as="button"
          aria-label="Account menu"
          flexShrink={0}
          maxW="220px"
          align="center"
          gap={2.5}
          h="44px"
          px={2}
          borderRadius="lg"
          cursor="pointer"
          textAlign="left"
          transition="background 120ms ease"
          _hover={{ bg: "bg.subtle" }}
        >
          {user ? (
            <PersonAvatar user={user} size={32} />
          ) : (
            <Flex
              flexShrink={0}
              align="center"
              justify="center"
              boxSize="32px"
              borderRadius="full"
              bg="app.green.primary"
              color="app.green.secondary"
              fontSize="sm"
              fontWeight="bold"
            >
              <Icon as={FiUser} boxSize="16px" />
            </Flex>
          )}
          {/* minW=0 is what lets the two lines truncate instead of pushing
              the chevron off the end of the bar. The email is the first thing
              to go: on a phone the avatar and the name are the whole chip. */}
          <Box minW={0} flex="1" display={{ base: "none", sm: "block" }}>
            <Text fontSize="sm" fontWeight="semibold" color="fg" truncate>
              {name}
            </Text>
            {email ? (
              <Text
                fontSize="xs"
                color="fg.muted"
                truncate
                display={{ base: "none", lg: "block" }}
              >
                {email}
              </Text>
            ) : null}
          </Box>
          <Icon
            as={FiChevronDown}
            boxSize="16px"
            color="fg.subtle"
            flexShrink={0}
          />
        </Flex>
      </MenuTrigger>

      <MenuContent minW="200px">
        <Link to="/settings" onClick={onNavigate}>
          <MenuItem
            closeOnSelect
            value="user-settings"
            gap={2}
            py={2}
            style={{ cursor: "pointer" }}
          >
            <FiSettings fontSize="16px" />
            <Box flex="1" position="relative" top="1px">
              Settings
            </Box>
          </MenuItem>
        </Link>
        {user?.is_superuser ? (
          <Link to="/admin" onClick={onNavigate}>
            <MenuItem
              closeOnSelect
              value="admin"
              gap={2}
              py={2}
              style={{ cursor: "pointer" }}
            >
              <FiShield fontSize="16px" />
              <Box flex="1" position="relative" top="1px">
                Admin
              </Box>
            </MenuItem>
          </Link>
        ) : null}
        <MenuSeparator />
        <MenuItem
          value="logout"
          gap={2}
          py={2}
          onClick={handleLogout}
          style={{ cursor: "pointer" }}
        >
          <FiLogOut fontSize="16px" />
          <Box as="span" position="relative" top="1px">
            Log Out
          </Box>
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}

export default NavAccount
