import { Button, Center, Flex, Text, VStack } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/cinema-showtimes/$cinemaId" as never)({
  component: CinemaShowtimesLinkPage,
})

function CinemaShowtimesLinkPage() {
  const cinemaId = window.location.pathname.replace(/^\/cinema-showtimes\//, "")

  return (
    <Center minH="100vh" px={4}>
      <Flex
        direction="column"
        align="center"
        gap={4}
        maxW="md"
        textAlign="center"
      >
        <Text fontSize="2xl" fontWeight="bold">
          Cinema Page Link
        </Text>

        <Text>
          Cinema links are opened via the app. You can browse movies and
          showtimes from here instead.
        </Text>

        <Text color="gray.500" fontSize="sm">
          Link target: <strong>/{cinemaId}</strong>
        </Text>

        <VStack gap={2}>
          <Button
            onClick={() => window.location.assign("/movies")}
            colorScheme="teal"
          >
            Go to Movies
          </Button>
        </VStack>
      </Flex>
    </Center>
  )
}
