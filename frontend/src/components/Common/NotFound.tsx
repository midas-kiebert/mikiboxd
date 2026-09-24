/**
 * Shared web layout/presentation component: Not Found.
 */
import { Button, Center, Flex, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"

import { defaultFeedParams } from "@/features/showtimes/feed-params"

const NotFound = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <>
      <Flex
        height="100vh"
        align="center"
        justify="center"
        flexDir="column"
        data-testid="not-found"
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
              404
            </Text>
            <Text fontSize="2xl" fontWeight="bold" mb={2}>
              Oops!
            </Text>
          </Flex>
        </Flex>

        <Text
          fontSize="lg"
          color="fg.muted"
          mb={4}
          textAlign="center"
          zIndex={1}
        >
          The page you are looking for was not found.
        </Text>
        <Center zIndex={1}>
          <Link to="/" search={defaultFeedParams}>
            <Button
              variant="solid"
              colorScheme="teal"
              mt={4}
              alignSelf="center"
            >
              Go Back
            </Button>
          </Link>
        </Center>
      </Flex>
    </>
  )
}

export default NotFound
