/**
 * TanStack Router route module for . It connects URL state to the matching page component.
 */
import { Flex } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { MeService } from "shared"

import BottomNavBar from "@/components/Common/BottomNavBar"
import InstallAppGate from "@/components/Common/InstallAppGate"
import TopNavBar from "@/components/Common/TopNavBar"
import IntroHost from "@/components/Intro/IntroHost"
import VerifyEmailTip from "@/components/Tips/VerifyEmailTip"
import { PAGE_NOTICE_BANNER_OFFSET_CSS } from "@/constants"
import { useIsMobile } from "@/hooks/useIsMobile"
import { Box } from "@chakra-ui/react"
import useTrackEvent from "shared/hooks/useTrackEvent"

import { primeSession } from "@/auth/session"
import { useIsSignedIn } from "@/auth/useSession"

/** The fixed bottom nav on a phone, which the scrolling content has to clear. */
const BOTTOM_NAV_HEIGHT = 60

export const Route = createFileRoute("/_layout")({
  component: Layout,
  // Resolve the session before the first child renders, but never redirect on
  // it: the feed and the film pages are open to guests, and the five pages that
  // do need an account gate themselves with `RequireAccount`. Priming here is
  // what lets `useIsSignedIn()` answer synchronously everywhere below.
  beforeLoad: async () => {
    await primeSession()
  },
})

function Layout() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const isMobile = useIsMobile()
  const { trackEvent } = useTrackEvent()
  const isSignedIn = useIsSignedIn()

  // An Apple/Google account is created without a username, and closing the
  // tab on /pick-username would otherwise leave it nameless for good. Every
  // signed-in page is under this layout, so this is the one place to send it
  // back — keeping the page it was on, to return to afterwards.
  const navigate = useNavigate()
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: MeService.getCurrentUser,
    enabled: isSignedIn,
    staleTime: 5 * 60_000,
  })
  const needsUsername =
    isSignedIn && currentUser != null && !currentUser.display_name?.trim()
  useEffect(() => {
    if (!needsUsername) return
    const here = window.location.pathname + window.location.search
    void navigate({
      to: "/pick-username",
      search: { redirect: here },
      replace: true,
    })
  }, [needsUsername, navigate])

  useEffect(() => {
    // One per page load, and per sign-in. Only for an account: `/me/events`
    // stores a user id, so a guest's open would just be a 401 on every page.
    if (isSignedIn) trackEvent("app_open")
  }, [isSignedIn, trackEvent])

  // The nav is a row in this column rather than a fixed overlay, so the box
  // below it simply takes the height that is left. Nothing downstream clears
  // it — which is the point of the bar replacing the sidebar.
  return (
    <InstallAppGate
      headline="Every film at your selected cinemas, in one app"
      body="MiKiNO lists every screening, from new releases to one-off specials. Keep a watchlist, see what your friends are going to, and plan a night out together."
      rememberDismissal
    >
      <Flex
        direction="column"
        height={`calc(100vh - ${PAGE_NOTICE_BANNER_OFFSET_CSS})`}
        mt={PAGE_NOTICE_BANNER_OFFSET_CSS}
      >
        <TopNavBar />
        {isMobile ? <BottomNavBar /> : null}
        <Box
          flex="1"
          minH={0}
          px={isMobile ? 2 : 0}
          mb={isMobile ? `${BOTTOM_NAV_HEIGHT}px` : 0}
          overflowY="auto"
        >
          <Outlet />
        </Box>
        <IntroHost />
        <VerifyEmailTip />
      </Flex>
    </InstallAppGate>
  )
}

export default Layout
