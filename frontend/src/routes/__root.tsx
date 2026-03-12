/**
 * TanStack Router route module for root. It connects URL state to the matching page component.
 */
import { Outlet, createRootRoute } from "@tanstack/react-router"
import React, { Suspense, useEffect, useState } from "react"

import NotFound from "@/components/Common/NotFound"
import { Box, CloseButton, Flex, Link, Text } from "@chakra-ui/react"

const BETA_NOTICE_DISMISSED_KEY = "betaNoticeDismissed"

const BetaNotice = () => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const dismissed = window.localStorage.getItem(BETA_NOTICE_DISMISSED_KEY)
      if (dismissed === "1") setIsVisible(false)
    } catch {
      // ignore storage read errors
    }
  }, [])

  const handleDismiss = () => {
    setIsVisible(false)
    try {
      window.localStorage.setItem(BETA_NOTICE_DISMISSED_KEY, "1")
    } catch {
      // ignore storage write errors
    }
  }

  if (!isVisible) return null

  return (
    <Box
      bg="blue.50"
      borderBottomWidth="1px"
      borderColor="blue.200"
      py={2}
      px={3}
    >
      <Flex align="center" justify="space-between" gap={2}>
        <Text fontSize="sm">
          Want to try the app?{" "}
          <Link href="/beta" color="blue.700" fontWeight="semibold">
            Click here to join the beta
          </Link>
          .
        </Text>
        <CloseButton
          size="sm"
          onClick={handleDismiss}
          aria-label="Dismiss beta notice"
        />
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
  import.meta.env.DEV ? React.lazy(loadDevtools) : () => null

export const Route = createRootRoute({
  component: () => (
    <>
      <BetaNotice />
      <Outlet />
      <Suspense>
        <TanStackDevtools />
      </Suspense>
    </>
  ),
  notFoundComponent: () => <NotFound />,
})
