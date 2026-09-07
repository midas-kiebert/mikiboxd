/**
 * Settings → Blocked accounts.
 *
 * The counterpart to blocking: without a list, a block is irreversible from the
 * website, which is why the menu can afford to block without confirming.
 */
import { Container, Flex, Heading, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MeService, UsersService } from "shared/client"

import { useIsSignedIn } from "@/auth/useSession"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"

const blockedUsersQueryKey = ["me", "blocked-users"] as const

const BlockedAccounts = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()

  const { data: blocked, isLoading } = useQuery({
    queryKey: blockedUsersQueryKey,
    queryFn: () => MeService.getBlockedUsers(),
    enabled: isSignedIn,
  })

  const { mutate: unblock, isPending } = useMutation({
    mutationFn: (userId: string) => UsersService.unblockUser({ userId }),
    onSuccess: () => {
      showSuccessToast("Unblocked.")
      queryClient.invalidateQueries({ queryKey: blockedUsersQueryKey })
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  // Render/output using the state and derived values prepared above.
  return (
    <Container maxW="full">
      <Heading size="sm" py={4}>
        Blocked accounts
      </Heading>

      {isLoading ? null : blocked?.length ? (
        <Stack gap={2} maxW="md">
          {blocked.map((user) => (
            <Flex key={user.id} align="center" justify="space-between" gap={4}>
              <Text fontSize="sm">{user.display_name ?? "Someone"}</Text>
              <Button
                size="xs"
                variant="surface"
                disabled={isPending}
                onClick={() => unblock(user.id)}
              >
                Unblock
              </Button>
            </Flex>
          ))}
        </Stack>
      ) : (
        <Text color="fg.muted">
          You haven't blocked anyone. Blocking someone hides you from each other
          and stops them contacting you.
        </Text>
      )}
    </Container>
  )
}

export default BlockedAccounts
