/**
 * Block and report, on any user row.
 *
 * The website had neither. Both stores treat them as required in the app, and a
 * web client carrying the same accounts and the same friend requests has the
 * same obligation — someone being harassed should not have to install an app to
 * make it stop.
 *
 * Blocking is offered without a confirmation step but is reversible from
 * Settings → Blocked accounts, which is the trade the app makes too: the moment
 * you want to block someone is not the moment to be asked twice.
 */
import { useState } from "react"
import { Button, Flex, IconButton, Portal, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FiMoreVertical } from "react-icons/fi"
import type { UserReportReason } from "shared"
import { UsersService } from "shared/client"
import { REPORT_REASON_OPTIONS } from "shared/moderation/report-reasons"

import { DialogBody, DialogContent, DialogHeader, DialogRoot, DialogTitle } from "@/components/ui/dialog"
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu"
import useCustomToast from "@/hooks/useCustomToast"

type UserModerationMenuProps = {
  userId: string
  /** Shown in the report dialog's title, so the target is never ambiguous. */
  userName: string
  isBlocked?: boolean
}

const UserModerationMenu = ({
  userId,
  userName,
  isBlocked = false,
}: UserModerationMenuProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const [isReportOpen, setIsReportOpen] = useState(false)

  const refreshPeople = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] })
    queryClient.invalidateQueries({ queryKey: ["me", "blocked-users"] })
  }

  const { mutate: block } = useMutation({
    mutationFn: () => UsersService.blockUser({ userId }),
    onSuccess: () => {
      showSuccessToast(`${userName} is blocked.`)
      refreshPeople()
    },
  })

  const { mutate: unblock } = useMutation({
    mutationFn: () => UsersService.unblockUser({ userId }),
    onSuccess: () => {
      showSuccessToast(`${userName} is unblocked.`)
      refreshPeople()
    },
  })

  const { mutate: report, isPending: isReporting } = useMutation({
    mutationFn: (reason: UserReportReason) =>
      UsersService.reportUser({ userId, requestBody: { reason } }),
    onSuccess: () => {
      setIsReportOpen(false)
      showSuccessToast("Thanks — we'll take a look.")
      refreshPeople()
    },
  })

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <MenuRoot>
        <MenuTrigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={`More options for ${userName}`}
          >
            <FiMoreVertical />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          {isBlocked ? (
            <MenuItem value="unblock" onClick={() => unblock()}>
              Unblock
            </MenuItem>
          ) : (
            <MenuItem value="block" onClick={() => block()}>
              Block
            </MenuItem>
          )}
          <MenuItem value="report" onClick={() => setIsReportOpen(true)}>
            Report
          </MenuItem>
        </MenuContent>
      </MenuRoot>

      <DialogRoot
        open={isReportOpen}
        onOpenChange={(details) => setIsReportOpen(details.open)}
      >
        <Portal>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Report {userName}?</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Text color="fg.muted" mb={3} fontSize="sm">
                Pick the closest reason. Reports are reviewed by a person.
              </Text>
              <Stack gap={2}>
                {REPORT_REASON_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant="surface"
                    justifyContent="flex-start"
                    loading={isReporting}
                    onClick={() => report(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </Stack>
              <Flex justify="flex-end" mt={4}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsReportOpen(false)}
                >
                  Cancel
                </Button>
              </Flex>
            </DialogBody>
          </DialogContent>
        </Portal>
      </DialogRoot>
    </>
  )
}

export default UserModerationMenu
