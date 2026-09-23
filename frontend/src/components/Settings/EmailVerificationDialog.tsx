/**
 * "Confirm your email first" — the app's `EmailVerificationRequiredDialog`.
 *
 * Raised wherever something is routed to an unconfirmed address (the digest,
 * a notification set to Email) and from the profile's "Not verified" badge.
 * Nothing is emailed until the address is confirmed, so the dialog carries the
 * one thing that can be done about it: sending the link again. Painted as sent
 * on the press, since the backend answers the same either way.
 */
import { Stack, Text } from "@chakra-ui/react"
import { useState } from "react"
import { MeService } from "shared/client"
import useAuth from "shared/hooks/useAuth"

import { ConfirmDialog } from "./settings-controls"

const EmailVerificationDialog = ({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) => {
  const { user } = useAuth()
  const [hasResent, setHasResent] = useState(false)
  // A "Link sent" from an earlier prompt never carries into the next one.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setHasResent(false)
  }

  return (
    <ConfirmDialog
      open={open}
      title="Confirm your email first"
      message="We can't email you until you've opened the confirmation link we sent."
      cancelLabel="Not now"
      confirmLabel={hasResent ? "Link sent" : "Send the link again"}
      closeOnConfirm={false}
      confirmBusy={hasResent}
      onConfirm={() => {
        setHasResent(true)
        MeService.resendEmailVerification().catch(() => {})
      }}
      onClose={onClose}
    >
      <Stack gap="2px" mt={3} p={3} borderRadius="10px" bg="bg.subtle">
        <Text fontSize="sm" fontWeight="700">
          {user?.email ?? ""}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {hasResent
            ? "Check your inbox, and your spam folder."
            : "Already opened it? It may take a moment to take effect."}
        </Text>
      </Stack>
    </ConfirmDialog>
  )
}

export default EmailVerificationDialog
