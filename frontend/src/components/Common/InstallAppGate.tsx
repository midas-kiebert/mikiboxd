/**
 * Mobile install gate for the shared-link routes (`/ping/...`, `/movie/...`,
 * `/add-friend/...`).
 *
 * A shared MiKiNO link reaches the web far less often than it looks: an
 * installed app intercepts the tap first, via the iOS `applinks` association
 * and the Android App Links intent filters, and the browser is never involved.
 * So a phone loading one of these pages almost always means "no app on this
 * device", and the useful answer is the store — not a web page that asks for a
 * login to an account the visitor does not have yet.
 *
 * "Almost always", not "always": iOS falls through to the browser when the URL
 * was typed rather than tapped, or when the user once picked "open in browser"
 * for the domain, and Android App Links are skipped by some in-app browsers
 * (Instagram, Facebook). That is why this is a panel with a button and not an
 * automatic redirect — guessing wrong costs one tap on "Continue in browser"
 * instead of throwing someone who already has the app into a store listing.
 *
 * Two cases are passed straight through:
 *   - desktop, which has no app to install;
 *   - a visitor with a web session, who is a deliberate web user rather than
 *     someone who arrived from a chat.
 */
import { Button, Center, Flex, Image, Link, Text } from "@chakra-ui/react"
import { type ReactNode, useEffect, useState } from "react"
import { storage } from "shared/storage"

import {
  type MobilePlatform,
  STORE_BADGES,
  detectMobilePlatform,
  getInstallUrl,
} from "@/app-install"

const MIKINO_LOGO_URL = "/assets/images/mikino-logo.png"
const LOGO_SIZE = "96px"

type InstallAppGateProps = {
  /** What this particular link was, in the visitor's terms. */
  headline: string
  /** One line on what the app will do with it once installed. */
  body: string
  children: ReactNode
}

export default function InstallAppGate({
  headline,
  body,
  children,
}: InstallAppGateProps) {
  // Resolved once on mount: neither the agent string nor the presence of a
  // token changes under a page that is already open.
  const [platform] = useState<MobilePlatform | null>(detectMobilePlatform)
  const [hasWebSession, setHasWebSession] = useState<boolean | null>(null)
  const [isContinuingInBrowser, setIsContinuingInBrowser] = useState(false)

  useEffect(() => {
    if (platform === null) return

    let isMounted = true
    storage
      .getItem("access_token")
      .then((token) => {
        if (isMounted) setHasWebSession(Boolean(token))
      })
      .catch(() => {
        if (isMounted) setHasWebSession(false)
      })

    return () => {
      isMounted = false
    }
  }, [platform])

  // The path is the whole payload on Android: it rides the Play referrer through
  // the install so the app can land on this link instead of an empty home tab.
  const installUrl =
    platform === null ? null : getInstallUrl(platform, window.location.pathname)

  // No store link for this platform yet (iOS, until the listing is live): the
  // web page is a worse answer than the app but a much better one than a button
  // that 404s.
  if (platform === null || installUrl === null || isContinuingInBrowser) {
    return <>{children}</>
  }

  // Held for the one microtask the token read takes. Rendering the children
  // first and swapping them out would flash the web page on every open.
  if (hasWebSession === null) return null
  if (hasWebSession) return <>{children}</>

  return (
    <Center minH="100vh" px={6}>
      <Flex direction="column" align="center" gap={5} maxW="sm" textAlign="center">
        <Image src={MIKINO_LOGO_URL} alt="MiKiNO" boxSize={LOGO_SIZE} borderRadius="22%" />

        <Text fontSize="2xl" fontWeight="bold">
          {headline}
        </Text>

        <Text>{body}</Text>

        {/*
          The stores' own badge artwork rather than a styled button: both Apple
          and Google require it for a link into their store, and it is also the
          thing a phone user recognises without reading. A real anchor, not a
          click handler, so the OS gets its chance to hand the URL straight to
          the store app.
        */}
        <Link
          href={installUrl}
          display="inline-block"
          aria-label={STORE_BADGES[platform].alt}
        >
          <Image
            src={STORE_BADGES[platform].src}
            alt={STORE_BADGES[platform].alt}
            height={STORE_BADGES[platform].height}
            maxW="100%"
          />
        </Link>

        {/*
          Android carries the link through the install on its own, so this is
          addressed to iOS, where nothing survives the App Store and the visitor
          has to bring the link back themselves. Tapping it a second time opens
          the app directly, and the app resumes it after sign-up.
        */}
        {platform === "ios" ? (
          <Text fontSize="xs" opacity={0.7}>
            Once it is installed, open the link you received again.
          </Text>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsContinuingInBrowser(true)}
        >
          Continue in browser
        </Button>

        {/* Required wherever Google's badge is shown. */}
        {platform === "android" ? (
          <Text fontSize="10px" opacity={0.6}>
            Google Play and the Google Play logo are trademarks of Google LLC.
          </Text>
        ) : null}
      </Flex>
    </Center>
  )
}
