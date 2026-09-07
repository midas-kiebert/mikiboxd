/**
 * Route-level gate for the pages that cannot mean anything without an account —
 * the agenda, friends, invites, settings, admin.
 *
 * This is deliberately not the old `beforeLoad` redirect. That redirect sat on
 * `_layout` and so covered the browsing pages too, which is what made the whole
 * website account-only. Gating here, per page, leaves the feed and the movie
 * pages open to guests while these five still ask for a sign-in.
 *
 * A panel rather than a redirect: a guest who clicked "Friends" to see what it
 * is should get an answer, not a login form with no explanation of what it was
 * for.
 */
import { Button, Center, Flex, Text } from "@chakra-ui/react"
import { Link, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { useIsSignedIn } from "@/auth/useSession"

type RequireAccountProps = {
  /** What the visitor was trying to reach, in their words. */
  feature: string
  children: ReactNode
}

const RequireAccount = ({ feature, children }: RequireAccountProps) => {
  const isSignedIn = useIsSignedIn()
  const href = useRouterState({ select: (state) => state.location.href })

  if (isSignedIn) return <>{children}</>

  return (
    <Center minH="60vh" px={6}>
      <Flex
        direction="column"
        align="center"
        gap={4}
        maxW="sm"
        textAlign="center"
      >
        <Text fontSize="xl" fontWeight="bold">
          Sign in to see {feature}
        </Text>
        <Text color="fg.muted">
          You can browse showtimes and films without an account. {feature} needs
          one.
        </Text>
        <Flex gap={3}>
          <Button asChild>
            <Link to="/login" search={{ redirect: href }}>
              Log in
            </Link>
          </Button>
          <Button asChild variant="surface">
            <Link to="/signup">Sign up</Link>
          </Button>
        </Flex>
      </Flex>
    </Center>
  )
}

export default RequireAccount
