/**
 * Shared web layout/presentation component: PrivacyPolicy.
 *
 * The privacy policy required by App Store Review guideline 5.1.1(i): a real
 * page, linked from the mobile app's Settings and from App Store Connect's
 * privacy-policy field, not just described there. Content matches what the
 * backend actually collects and stores — see backend/app/models/user.py and
 * app/models/analytics_event.py — rather than a generic template.
 */
import { Box, Flex, Heading, Link as ChakraLink, Text, VStack } from "@chakra-ui/react"

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box mb={6}>
    <Heading size="md" mb={2}>
      {title}
    </Heading>
    <VStack align="start" gap={2}>
      {children}
    </VStack>
  </Box>
)

const PrivacyPolicy = () => {
  return (
    <Flex justify="center" px={4} py={10}>
      <Box maxWidth="640px" width="100%">
        <Heading size="xl" mb={2}>
          Privacy Policy
        </Heading>
        <Text fontSize="sm" color="gray.500" mb={8}>
          Last updated 18 August 2026
        </Text>

        <Section title="What we collect">
          <Text>
            When you create a MiKiNO account, we store your email address, the username you
            choose, and your password (hashed — we never store it in plain text, and cannot read
            it back). If you sign in with Apple or Google, we store the identifier that provider
            gives us for your account instead of a password.
          </Text>
          <Text>
            If you connect a Letterboxd account, we store the username you provide and the list of
            films on your watchlist and watched list, so we can match them against showtimes.
          </Text>
          <Text>
            If you enable notifications, we store a device push token so we can deliver them. We do
            not collect your location, contacts, photos, or microphone/camera data — MiKiNO never
            asks for access to any of these.
          </Text>
          <Text>
            We record which screenings you mark as going to or interested in, your friends and
            friend requests, and invites you send or receive, since showing this to your friends
            (subject to your visibility settings) is the app&apos;s core function.
          </Text>
          <Text>
            We record basic usage events against your account — such as signing in, opening the
            app, and applying a filter — to understand which features are actually used. We do not
            use any third-party analytics or advertising SDK, and MiKiNO does not track you across
            other apps or websites.
          </Text>
        </Section>

        <Section title="How we use it">
          <Text>
            Your data is used to run the app: to show you showtimes, to show your friends what
            you&apos;re going to (according to your visibility settings), to deliver the
            notifications you&apos;ve opted into, and to send the email digest if you&apos;ve turned
            it on. We do not sell your data, and we do not share it with third parties for
            advertising.
          </Text>
          <Text>
            We use a small number of service providers to run the app: an email delivery provider
            to send account and notification emails, and a push notification service (Firebase
            Cloud Messaging / Apple Push Notification service) to deliver push notifications. These
            providers only see what is necessary to deliver that message.
          </Text>
        </Section>

        <Section title="Other users">
          <Text>
            Your username is visible to other users, in search and on invites. Depending on your
            visibility settings, your going/interested status on a showtime may be visible to your
            friends. You can block another user at any time from their profile, which removes any
            friendship and invites between you and stops further contact in either direction. You
            can report a user for harassment, impersonation, spam, or an objectionable username; we
            review reports and may suspend or ban an account as a result.
          </Text>
        </Section>

        <Section title="Retention and deletion">
          <Text>
            We keep your data for as long as your account exists. You can delete your account at
            any time from Settings → Danger zone in the app — this permanently removes your
            account, your friends, your showtime selections, and your invites. This cannot be
            undone.
          </Text>
          <Text>
            If you signed in with Apple, deleting your account also revokes the Sign in with Apple
            authorization associated with it.
          </Text>
          <Text>
            To withdraw consent for notifications or the email digest without deleting your
            account, use the toggles in Settings, or the unsubscribe link in any digest email.
          </Text>
        </Section>

        <Section title="Contact">
          <Text>
            Questions about this policy, or a request to access or delete your data, can be sent to{" "}
            <ChakraLink href="mailto:info@mikino.nl" color="teal.500">
              info@mikino.nl
            </ChakraLink>
            .
          </Text>
        </Section>
      </Box>
    </Flex>
  )
}

export default PrivacyPolicy
