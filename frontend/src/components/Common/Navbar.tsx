/**
 * Shared web layout/presentation component: Navbar.
 */
import { Flex, Image, useBreakpointValue } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"

import Logo from "/assets/images/fastapi-logo.svg"
import UserMenu from "./UserMenu"

function Navbar() {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const display = useBreakpointValue({ base: "none", md: "flex" })

  // Render/output using the state and derived values prepared above.
  return (
    <Flex
      display={display}
      justify="space-between"
      position="fixed"
      color="white"
      align="center"
      bg="bg.muted"
      w="100%"
      top={0}
      p={4}
    >
      <Link to="/">
        <Image src={Logo} alt="Logo" maxW="3xs" p={2} />
      </Link>
      <Flex gap={2} alignItems="center">
        <UserMenu />
      </Flex>
    </Flex>
  )
}

export default Navbar
