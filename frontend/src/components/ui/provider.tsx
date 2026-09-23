/**
 * Reusable Chakra-based UI primitive: Provider. This keeps common UI patterns consistent.
 */
"use client"

import { ChakraProvider } from "@chakra-ui/react"
import { type PropsWithChildren, useSyncExternalStore } from "react"

import { useIsSignedIn } from "@/auth/useSession"
import { system } from "../../theme"
import { ColorModeProvider } from "./color-mode"
import { Toaster } from "./toaster"

const DARK_QUERY = "(prefers-color-scheme: dark)"

const subscribeToSystemTheme = (onChange: () => void) => {
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

const getSystemTheme = () =>
  window.matchMedia(DARK_QUERY).matches ? "dark" : "light"

/** The OS theme, live — what a guest's page is pinned to. */
const useSystemTheme = () =>
  useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, () => "light")

/**
 * Signed in, from the first paint. The session store only answers once the
 * router has primed it, and this provider renders before that — reading the
 * token directly keeps a member's chosen theme from flashing to the OS one.
 */
const useIsSignedInNow = () => {
  const isSignedIn = useIsSignedIn()
  try {
    return isSignedIn || Boolean(localStorage.getItem("access_token"))
  } catch {
    return isSignedIn
  }
}

export function CustomProvider(props: PropsWithChildren) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedInNow()
  const systemTheme = useSystemTheme()
  return (
    <ChakraProvider value={system}>
      {/*
        `system` follows the OS until the visitor picks a side in Settings ->
        Appearance, which is the behaviour the app has. A guest has no
        Appearance section and always follows the OS; a member's choice stays
        stored and comes back when they sign in again.
      */}
      <ColorModeProvider
        defaultTheme="system"
        enableSystem
        forcedTheme={isSignedIn ? undefined : systemTheme}
      >
        {props.children}
      </ColorModeProvider>
      <Toaster />
    </ChakraProvider>
  )
}
