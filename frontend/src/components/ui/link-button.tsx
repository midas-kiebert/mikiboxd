/**
 * Reusable Chakra-based UI primitive: Link button. This keeps common UI patterns consistent.
 */
"use client"

import type { HTMLChakraProps, RecipeProps } from "@chakra-ui/react"
import { createRecipeContext } from "@chakra-ui/react"

export interface LinkButtonProps
  extends HTMLChakraProps<"a", RecipeProps<"button">> {}

const { withContext } = createRecipeContext({ key: "button" })

// Replace "a" with your framework's link component
export const LinkButton = withContext<HTMLAnchorElement, LinkButtonProps>("a")
