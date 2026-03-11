import { Button, Center, Flex, Text, VStack } from "@chakra-ui/react"
import { Link as RouterLink, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/cinema-showtimes/$cinemaId")({
  component: CinemaShowtimesLinkPage,
})

function CinemaShowtimesLinkPage() {
  const { cinemaId } = Route.useParams()

  return (
    <Center minH="100vh" px={4}>
      <Flex direction="column" align="center" gap={4} maxW="md" textAlign="center">
        <Text fontSize="2xl" fontWeight="bold">
          Cinema Page Link
        </Text>

        <Text>
          Cinema links are opened via the app. You can browse movies and showtimes from here
          instead.
        </Text>

        <Text color="gray.500" fontSize="sm">
          Link target: <strong>/{cinemaId}</strong>
        </Text>

        <VStack gap={2}>
          <RouterLink to="/movies">
            <Button colorScheme="teal">Go to Movies</Button>
          </RouterLink>
        </VStack>
      </Flex>
    </Center>
  )
}
