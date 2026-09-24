/**
 * Mobile install prompt, shown on a phone in place of the web page.
 *
 * Wraps the shared-link routes (`/ping/...`, `/movie/...`, `/add-friend/...`)
 * and the main layout, for someone who opened the site directly.
 *
 * A shared MiKiNO link reaches the web far less often than it looks: an
 * installed app intercepts the tap first, via the iOS `applinks` association
 * and the Android App Links intent filters, and the browser is never involved.
 * So a phone loading one of these pages almost always means "no app on this
 * device", and the useful answer is the store.
 *
 * "Almost always", not "always": iOS falls through to the browser when the URL
 * was typed rather than tapped, or when the user once picked "open in browser"
 * for the domain, and Android App Links are skipped by some in-app browsers
 * (Instagram, Facebook). That is why this is a page with a button and a quiet
 * way past it, not an automatic redirect.
 *
 * Passed straight through:
 *   - desktop, which has no app to install;
 *   - a visitor with a web session, who is a deliberate web user;
 *   - with `rememberDismissal`, a visitor who has skipped it before.
 */
import { Box, Flex, Image, Link, Text } from "@chakra-ui/react"
import { type ReactNode, useEffect, useState } from "react"
import { storage } from "shared/storage"

import {
  type MobilePlatform,
  STORE_BADGES,
  detectMobilePlatform,
  getInstallUrl,
} from "@/app-install"
import { Button } from "@/components/ui/button"

const MIKINO_LOGO_URL = "/assets/images/mikino-logo.png"
const LOGO_SIZE = "88px"
const POSTER_WIDTH = "56px"

/** Set once a visitor skips the prompt on a plain visit; never cleared. */
const INSTALL_PROMPT_DISMISSED_KEY = "installPromptDismissed"

export type InstallPromptCard = {
  posterUrl: string | null
  title: string
  subtitle?: string
}

type InstallAppGateProps = {
  /** What this particular link was, in the visitor's terms. */
  headline: string
  /** What MiKiNO is, for someone who has never heard of it. */
  body: string
  /** The one thing to do after installing, when the link needs an account. */
  nextStep?: string
  /** The film or screening the link is about, once it has loaded. */
  card?: InstallPromptCard | null
  /** iOS only: nothing survives the App Store, so the link must be reopened. */
  iosReopenHint?: string
  skipLabel?: string
  /** Skip once, skip for good. For plain visits, not for links. */
  rememberDismissal?: boolean
  children: ReactNode
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) === "1"
  } catch {
    return false
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, "1")
  } catch {
    // A private window forgets it; the prompt coming back there is fine.
  }
}

export default function InstallAppGate({
  headline,
  body,
  nextStep,
  card,
  iosReopenHint,
  skipLabel = "Continue on the website",
  rememberDismissal = false,
  children,
}: InstallAppGateProps) {
  // Resolved once on mount: neither the agent string nor the presence of a
  // token changes under a page that is already open.
  const [platform] = useState<MobilePlatform | null>(detectMobilePlatform)
  const [hasWebSession, setHasWebSession] = useState<boolean | null>(null)
  const [isSkipped, setIsSkipped] = useState(
    () => rememberDismissal && readDismissed(),
  )

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

  if (platform === null || installUrl === null || isSkipped) {
    return <>{children}</>
  }

  // Held for the one microtask the token read takes. Rendering the children
  // first and swapping them out would flash the web page on every open.
  if (hasWebSession === null) return null
  if (hasWebSession) return <>{children}</>

  const handleSkip = () => {
    if (rememberDismissal) writeDismissed()
    setIsSkipped(true)
  }

  return (
    <Flex
      direction="column"
      align="center"
      minH="100dvh"
      px={6}
      pt="12dvh"
      pb={8}
      bg="bg"
    >
      <Flex direction="column" align="center" w="100%" maxW="sm" flex="1">
        <Image
          src={MIKINO_LOGO_URL}
          alt="MiKiNO"
          boxSize={LOGO_SIZE}
          borderRadius="22%"
          boxShadow="md"
        />

        <Text
          mt={6}
          fontSize="2xl"
          fontWeight="bold"
          lineHeight="1.25"
          textAlign="center"
        >
          {headline}
        </Text>

        {card ? (
          <Flex
            mt={5}
            w="100%"
            gap={3}
            p={3}
            align="center"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            borderRadius="lg"
          >
            {card.posterUrl ? (
              <Image
                src={card.posterUrl}
                alt=""
                w={POSTER_WIDTH}
                aspectRatio={2 / 3}
                objectFit="cover"
                borderRadius="sm"
                flexShrink={0}
              />
            ) : null}
            <Box minW={0}>
              <Text fontWeight="semibold" lineClamp={2}>
                {card.title}
              </Text>
              {card.subtitle ? (
                <Text mt={0.5} fontSize="sm" color="fg.muted">
                  {card.subtitle}
                </Text>
              ) : null}
            </Box>
          </Flex>
        ) : null}

        <Text mt={5} textAlign="center" color="fg.muted">
          {body}
        </Text>

        {nextStep ? (
          <Text mt={3} textAlign="center" fontWeight="semibold">
            {nextStep}
          </Text>
        ) : null}

        <Box flex="1" minH={8} />

        {/*
          The store's own badge is the button: it is what a phone user
          recognises without reading, and both stores require their artwork
          unmodified, so it is sized by height alone. A real anchor, so the OS
          can hand the URL straight to the store app.
        */}
        <Link href={installUrl} aria-label={STORE_BADGES[platform].alt}>
          <Image
            src={STORE_BADGES[platform].src}
            alt={STORE_BADGES[platform].alt}
            height={STORE_BADGES[platform].height}
            maxW="100%"
          />
        </Link>

        {platform === "ios" && iosReopenHint ? (
          <Text mt={4} fontSize="sm" textAlign="center" color="fg.muted">
            {iosReopenHint}
          </Text>
        ) : null}

        <Button
          variant="plain"
          size="sm"
          mt={4}
          color="fg.subtle"
          fontWeight="normal"
          onClick={handleSkip}
        >
          {skipLabel}
        </Button>

        {/* Required wherever Google's badge is shown. */}
        {platform === "android" ? (
          <Text mt={2} fontSize="10px" color="fg.subtle" textAlign="center">
            Google Play and the Google Play logo are trademarks of Google LLC.
          </Text>
        ) : null}
      </Flex>
    </Flex>
  )
}
