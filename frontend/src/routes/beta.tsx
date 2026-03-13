import { Button, Center, Flex, Input, Link, Text } from "@chakra-ui/react"
import { type FormEvent, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/beta" as never)({
  component: BetaInstallPage,
})

function BetaInstallPage() {
  const [googlePlayEmail, setGooglePlayEmail] = useState("")

  const handleAndroidSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = googlePlayEmail.trim()
    if (!trimmedEmail) return

    const subject = encodeURIComponent("Android Beta Invite")
    const body = encodeURIComponent(
      `Google Play account email: ${trimmedEmail}`,
    )
    window.location.href = `mailto:android-beta@mikino.nl?subject=${subject}&body=${body}`
  }

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
        <Text>
          Enter the email address of the Google account you use in Google Play and
          submit to request access.
        </Text>

        <form
          onSubmit={handleAndroidSubmit}
          style={{ width: "100%" }}
        >
          <Flex direction="column" w="100%">
            <Input
              type="email"
              value={googlePlayEmail}
              onChange={(event) => setGooglePlayEmail(event.target.value)}
              placeholder="you@googleaccount.com"
              required
              mb={3}
            />
            <Button colorScheme="blue" type="submit">
              Submit
            </Button>
          </Flex>
        </form>
        <Text>
          After being accepted, you can install the app via
          <Link
              href="https://play.google.com/store/apps/details?id=com.midaskiebert.mikino"
              target="_blank"
              rel="noopener noreferrer"
              color="blue.500"
            >
              https://play.google.com/store/apps/details?id=com.midaskiebert.mikino
            </Link>
        </Text>
      </Flex>
    </Center>
  )
}
