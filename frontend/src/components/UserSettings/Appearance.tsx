/**
 * User settings feature component: Appearance.
 *
 * Offered exactly one option before this — "Light Mode" — with no dark theme
 * behind it, which read as broken next to an app that ships a full themed
 * palette. Three choices now, and "System" is the default so the site follows
 * the OS until someone says otherwise.
 */
import { Container, Heading, Stack, Text } from "@chakra-ui/react"
import { useTheme } from "next-themes"

import { Radio, RadioGroup } from "@/components/ui/radio"

const THEME_OPTIONS = [
  { value: "system", label: "System", hint: "Follow your device setting" },
  { value: "light", label: "Light", hint: null },
  { value: "dark", label: "Dark", hint: null },
]

const Appearance = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const { theme, setTheme } = useTheme()

  // Render/output using the state and derived values prepared above.
  return (
    <Container maxW="full">
      <Heading size="sm" py={4}>
        Appearance
      </Heading>

      <RadioGroup
        onValueChange={(details) => {
          if (details.value != null) setTheme(details.value)
        }}
        value={theme ?? "system"}
        colorPalette="teal"
      >
        <Stack gap={2}>
          {THEME_OPTIONS.map((option) => (
            <Radio key={option.value} value={option.value}>
              {option.label}
              {option.hint ? (
                <Text as="span" color="fg.muted" ms={2} fontSize="sm">
                  {option.hint}
                </Text>
              ) : null}
            </Radio>
          ))}
        </Stack>
      </RadioGroup>
    </Container>
  )
}

export default Appearance
