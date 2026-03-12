/**
 * TanStack Router route module for root. It connects URL state to the matching page component.
 */
import { Outlet, createRootRoute } from "@tanstack/react-router"
import { Box, CloseButton, Flex, Link, Text } from "@chakra-ui/react"
import React, { Suspense } from "react"

import {
  PAGE_NOTICE_BANNER_HEIGHT_PX,
  PAGE_NOTICE_BANNER_OFFSET_CSS_VAR,
} from "@/constants"
import NotFound from "@/components/Common/NotFound"

const BANNER_DISMISSED_KEY = "betaNoticeDismissed"

const BetaNotice = ({
  onDismiss,
}: {
  onDismiss: () => void
}) => {
  return (
    <Box
      bg="blue.50"
      borderBottomWidth="1px"
      borderColor="blue.200"
      height={PAGE_NOTICE_BANNER_HEIGHT_PX}
      px={3}
      position="fixed"
      top={0}
      left={0}
      right={0}
      zIndex={2000}
      display="flex"
      alignItems="center"
    >
      <Flex align="center" justify="space-between" gap={2} w="100%">
        <Text fontSize="sm">
          Try the beta version.{" "}
          <Link href="/beta" fontWeight="semibold">
            Open beta setup
          </Link>
          .
        </Text>
        <CloseButton size="sm" onClick={onDismiss} aria-label="Dismiss beta banner" />
      </Flex>
    </Box>
  )
}

const loadDevtools = () =>
  Promise.all([
    import("@tanstack/router-devtools"),
    import("@tanstack/react-query-devtools"),
  ]).then(([routerDevtools, reactQueryDevtools]) => {
    return {
      default: () => (
        <>
          <routerDevtools.TanStackRouterDevtools />
          <reactQueryDevtools.ReactQueryDevtools />
        </>
      ),
    }
  })

const TanStackDevtools =
  import.meta.env.PROD ? () => null : React.lazy(loadDevtools)

export const Route = createRootRoute({
  component: () => {
    const [isVisible, setIsVisible] = React.useState(true)

    React.useEffect(() => {
      try {
        const dismissed = window.localStorage.getItem(BANNER_DISMISSED_KEY)
        if (dismissed === "1") setIsVisible(false)
      } catch {
        // ignore localStorage failures in non-browser contexts
      }
    }, [])

    const handleDismiss = () => {
      try {
        window.localStorage.setItem(BANNER_DISMISSED_KEY, "1")
      } catch {
        // ignore localStorage failures in non-browser contexts
      }
      setIsVisible(false)
    }

    const bannerHeight = isVisible ? PAGE_NOTICE_BANNER_HEIGHT_PX : "0px"

    return (
      <Box
        style={
          {
            [PAGE_NOTICE_BANNER_OFFSET_CSS_VAR]: bannerHeight,
          } as React.CSSProperties
        }
      >
        {isVisible ? <BetaNotice onDismiss={handleDismiss} /> : null}
        <Outlet />
        <Suspense>
          <TanStackDevtools />
        </Suspense>
      </Box>
    )
  },
  notFoundComponent: () => <NotFound />,
})
