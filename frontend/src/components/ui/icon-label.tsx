/**
 * Text beside an icon, nudged down to meet it.
 *
 * Flex centring lines an icon up with the text's *line box*, and a word with
 * no descenders ("Amsterdam", "Website", "Block") leaves the bottom of that box
 * empty, so the letters sit visibly high. Wrap the label of any icon + text
 * pair in this — buttons and links included. The film row's buttons and the
 * rail's switches carry the same fix in their own CSS.
 */
import { Box } from "@chakra-ui/react"
import type { ReactNode } from "react"

export const IconLabel = ({ children }: { children: ReactNode }) => (
  <Box as="span" position="relative" top="1px">
    {children}
  </Box>
)
