import { Center, Flex, Link, Text } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/beta" as never)({
  component: BetaInstallPage,
})

function BetaInstallPage() {
  return (
    <Center minH="100vh" px={4}>
      <Flex
        direction="column"
        align="center"
        gap={4}
        maxW="md"
        textAlign="left"
      >
        <Text fontSize="2xl" fontWeight="bold" textAlign="center">
          How to install the Beta app
        </Text>

        <Text fontWeight="bold">iOS:</Text>
        <ol style={{ marginTop: "0", paddingLeft: "1.25rem" }}>
          <li>
            1. Install the TestFlight app from the App Store:{" "}
            <Link
              href="https://apps.apple.com/nl/app/testflight/id899247664"
              target="_blank"
              rel="noopener noreferrer"
              color="blue.500"
            >
              https://apps.apple.com/nl/app/testflight/id899247664
            </Link>
          </li>
          <li>
            2. Open the invite link in TestFlight:{" "}
            <Link
              href="https://testflight.apple.com/join/zdXye7CS"
              target="_blank"
              rel="noopener noreferrer"
              color="blue.500"
            >
              https://testflight.apple.com/join/zdXye7CS
            </Link>
          </li>
        </ol>

        <Text fontWeight="bold">Android:</Text>
        <ol style={{ marginTop: "0", paddingLeft: "1.25rem" }}>
          <li>
            Send an email to{" "}
            <Link
              href="mailto:android-beta@mikino.nl"
              target="_blank"
              rel="noopener noreferrer"
              color="blue.500"
            >
              android-beta@mikino.nl
            </Link>{" "}
            with the email address you use in Google Play.
          </li>
        </ol>
      </Flex>
    </Center>
  )
}
