/**
 * Shared web layout/presentation component: Forbidden.
 */
import { Button, Center, Flex, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"

const Forbidden = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <>
      <Flex
        height="100vh"
        align="center"
        justify="center"
        flexDir="column"
        data-testid="forbidden"
        p={4}
      >
        <Flex alignItems="center" zIndex={1}>
          <Flex flexDir="column" ml={4} align="center" justify="center" p={4}>
            <Text
              fontSize={{ base: "6xl", md: "8xl" }}
              fontWeight="bold"
              lineHeight="1"
              mb={4}
            >
              403
            </Text>
            <Text fontSize="2xl" fontWeight="bold" mb={2}>
              Forbidden
            </Text>
          </Flex>
        </Flex>

        <Text
          fontSize="lg"
          color="gray.600"
          mb={4}
          textAlign="center"
          zIndex={1}
        >
          You are not allowed to be here!
        </Text>
        <Center zIndex={1}>
          <Link to="/">
            <Button
              variant="solid"
              colorScheme="teal"
              mt={4}
              alignSelf="center"
            >
              Go Home
            </Button>
          </Link>
        </Center>
      </Flex>
    </>
  )
}

export default Forbidden
