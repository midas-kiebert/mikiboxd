/**
 * Shared web layout/presentation component: Support.
 */
import { Flex, Heading, Link as ChakraLink, Text } from "@chakra-ui/react"

const Support = () => {
  return (
    <Flex
      minHeight="100vh"
      align="center"
      justify="center"
      flexDir="column"
      data-testid="support"
      p={4}
    >
      <Heading size="xl" mb={4}>
        Support
      </Heading>
      <Text fontSize="lg" mb={2} textAlign="center">
        Need help with MiKiNO, or have feedback or a bug to report?
      </Text>
      <Text fontSize="lg" textAlign="center">
        Reach out at{" "}
        <ChakraLink href="mailto:info@mikino.nl" color="teal.500">
          info@mikino.nl
        </ChakraLink>
      </Text>
    </Flex>
  )
}

export default Support
