/**
 * Reusable Chakra-based UI primitive: Provider. This keeps common UI patterns consistent.
 */
"use client"

import { ChakraProvider } from "@chakra-ui/react"
import type { PropsWithChildren } from "react"
import { system } from "../../theme"
import { ColorModeProvider } from "./color-mode"
import { Toaster } from "./toaster"

export function CustomProvider(props: PropsWithChildren) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <ChakraProvider value={system}>
      {/*
        `system` follows the OS until the visitor picks a side in Settings ->
        Appearance, which is the behaviour the app has. It used to be pinned to
        light with no way to change it.
      */}
      <ColorModeProvider defaultTheme="system" enableSystem>
        {props.children}
      </ColorModeProvider>
      <Toaster />
    </ChakraProvider>
  )
}
