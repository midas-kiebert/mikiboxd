/**
 * Who can see that you picked this showtime.
 *
 * Only meaningful once you have picked it — a mode on a showtime you are not
 * going to governs nothing — so the panel renders this only when there is a
 * status to hide or show.
 *
 * The labels and descriptions come from `shared/showtimes/visibility-mode`,
 * which the app reads too: a privacy setting described one way on a phone and
 * another way on the web is how people share more than they meant to.
 */
import { Box, Flex, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { VisibilityMode } from "shared/client"
import { ShowtimesService } from "shared/client"
import {
  showtimeVisibilityQueryKey,
  useShowtimeVisibility,
} from "shared/hooks/useShowtimeVisibility"
import {
  VISIBILITY_MODE_ORDER,
  getVisibilityModeCopy,
} from "shared/showtimes/visibility-mode"

import { useIsSignedIn } from "@/auth/useSession"
import { Radio, RadioGroup } from "@/components/ui/radio"

type ShowtimeVisibilityControlProps = {
  showtimeId: number
}

const ShowtimeVisibilityControl = ({
  showtimeId,
}: ShowtimeVisibilityControlProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()

  const { data: visibility } = useShowtimeVisibility({
    showtimeId,
    enabled: isSignedIn,
  })

  const { mutate: setMode, isPending } = useMutation({
    mutationFn: (mode: VisibilityMode) =>
      ShowtimesService.updateShowtimeVisibility({
        showtimeId,
        requestBody: { mode },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(showtimeVisibilityQueryKey(showtimeId), updated)
      // Who appears as attending this showtime depends on it.
      queryClient.invalidateQueries({ queryKey: ["showtimes"] })
    },
  })

  if (!isSignedIn || !visibility) return null

  // Render/output using the state and derived values prepared above.
  return (
    <Stack gap={2}>
      <Text fontSize="sm" fontWeight="semibold" color="gray.600">
        Who can see this
      </Text>

      <RadioGroup
        value={visibility.mode}
        onValueChange={(details) => {
          if (details.value) setMode(details.value as VisibilityMode)
        }}
        disabled={isPending}
      >
        <Stack gap={2}>
          {VISIBILITY_MODE_ORDER.map((mode) => {
            const copy = getVisibilityModeCopy(mode)
            return (
              <Radio key={mode} value={mode}>
                <Box>
                  <Text fontSize="sm">{copy.label}</Text>
                  <Text fontSize="xs" color="gray.500">
                    {copy.description}
                  </Text>
                </Box>
              </Radio>
            )
          })}
        </Stack>
      </RadioGroup>

      <Flex>
        <Text fontSize="xs" color="gray.500">
          Friends you invited, and friends who invited you, can always see this.
        </Text>
      </Flex>
    </Stack>
  )
}

export default ShowtimeVisibilityControl
