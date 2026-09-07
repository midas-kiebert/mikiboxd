/**
 * "Confirm your email" — shown only while it is unconfirmed.
 *
 * The website could never resend the link, so a member whose confirmation mail
 * went astray had to open the app to get another one. Verification is a soft
 * gate (it blocks the digest, not the account), which is why this is a line at
 * the top of the profile tab rather than anything that stops you using the page.
 */
import { Flex, Text } from "@chakra-ui/react"
import { useMutation } from "@tanstack/react-query"
import { MeService } from "shared/client"
import useAuth from "shared/hooks/useAuth"

import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"

const EmailVerificationNotice = () => {
  const { user } = useAuth()
  const { showSuccessToast } = useCustomToast()

  const { mutate: resend, isPending } = useMutation({
    mutationFn: () => MeService.resendEmailVerification(),
    onSuccess: () => showSuccessToast("Confirmation email sent."),
  })

  if (!user || user.email_verified) return null

  return (
    <Flex
      align="center"
      justify="space-between"
      gap={3}
      wrap="wrap"
      mt={4}
      p={3}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.subtle"
    >
      <Text fontSize="sm">
        Your email isn't confirmed yet, so digest emails are paused.
      </Text>
      <Button
        size="xs"
        variant="surface"
        loading={isPending}
        onClick={() => resend()}
      >
        Send it again
      </Button>
    </Flex>
  )
}

export default EmailVerificationNotice
