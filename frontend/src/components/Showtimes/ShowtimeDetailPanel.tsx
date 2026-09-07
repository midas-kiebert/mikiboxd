/**
 * The panel that opens beside the feed when a showtime is selected.
 *
 * Phase 1 scope: read the showtime, set your status on it, and get a ticket.
 * Invites, per-showtime visibility, seat availability and sold-out watches are
 * the app's showtime sheet and belong to a later phase — the layout here leaves
 * room for them rather than pretending they exist.
 *
 * Docked rather than a centred dialog, which is the one real advantage the web
 * has over the app's full-screen sheet: the list stays visible, so setting a
 * status on one showtime does not hide the alternatives you were comparing it
 * against.
 *
 * Status buttons stay visible for guests and gate on press, per the app's rule
 * that pressing "Going" is how a signed-out visitor discovers what an account
 * is for.
 */
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Flex,
  Heading,
  Link,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import days from "dayjs"
import type { GoingStatus, ShowtimePublic } from "shared"
import { ShowtimesService } from "shared/client"

import { useRequireAccount } from "@/auth/useSession"

type ShowtimeDetailPanelProps = {
  showtime: ShowtimePublic
  onClose: () => void
}

const STATUS_BUTTONS: {
  status: GoingStatus
  label: string
  palette: string
}[] = [
  { status: "GOING", label: "Going", palette: "green" },
  { status: "INTERESTED", label: "Interested", palette: "orange" },
  { status: "NOT_GOING", label: "Not going", palette: "gray" },
]

const ShowtimeDetailPanel = ({
  showtime,
  onClose,
}: ShowtimeDetailPanelProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()
  const requireAccount = useRequireAccount()

  const current = showtime.viewer?.going
  const datetime = new Date(showtime.datetime)

  const { mutate: setStatus, isPending } = useMutation({
    mutationFn: (going_status: GoingStatus) =>
      ShowtimesService.updateShowtimeSelection({
        showtimeId: showtime.id,
        requestBody: { going_status },
      }),
    onSuccess: () => {
      // The feed, the agenda and the film page all show this showtime's status.
      queryClient.invalidateQueries({ queryKey: ["showtimes"] })
      queryClient.invalidateQueries({ queryKey: ["movies"] })
    },
  })

  const handleStatus = (status: GoingStatus) => {
    if (!requireAccount()) return
    setStatus(status === current ? "NOT_GOING" : status)
  }

  const friendsGoing = showtime.viewer?.friends_going ?? []
  const friendsInterested = showtime.viewer?.friends_interested ?? []

  // Render/output using the state and derived values prepared above.
  return (
    <Stack gap={4}>
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Heading size="md" lineHeight="short">
          {showtime.movie.title}
        </Heading>
        <CloseButton size="sm" onClick={onClose} aria-label="Close" />
      </Flex>

      <Box>
        <Text fontWeight="semibold">
          {days(datetime).format("ddd D MMMM, HH:mm")}
        </Text>
        <Text color="gray.600">{showtime.cinema.name}</Text>
        {showtime.room ? (
          <Text color="gray.500" fontSize="sm">
            {showtime.room}
          </Text>
        ) : null}
      </Box>

      {showtime.subtitles?.length ? (
        <Flex gap={1} wrap="wrap">
          {showtime.subtitles.map((subtitle) => (
            <Badge key={subtitle} variant="surface">
              {subtitle}
            </Badge>
          ))}
        </Flex>
      ) : null}

      <Stack gap={2}>
        <Text fontSize="sm" fontWeight="semibold" color="gray.600">
          Your status
        </Text>
        <Flex gap={2}>
          {STATUS_BUTTONS.map((option) => (
            <Button
              key={option.status}
              flex="1"
              size="sm"
              loading={isPending}
              colorPalette={option.palette}
              variant={current === option.status ? "solid" : "surface"}
              onClick={() => handleStatus(option.status)}
            >
              {option.label}
            </Button>
          ))}
        </Flex>
      </Stack>

      {friendsGoing.length || friendsInterested.length ? (
        <Stack gap={1}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.600">
            Friends
          </Text>
          {friendsGoing.length ? (
            <Text fontSize="sm">
              Going:{" "}
              {friendsGoing.map((f) => f.display_name ?? "A friend").join(", ")}
            </Text>
          ) : null}
          {friendsInterested.length ? (
            <Text fontSize="sm">
              Interested:{" "}
              {friendsInterested
                .map((f) => f.display_name ?? "A friend")
                .join(", ")}
            </Text>
          ) : null}
        </Stack>
      ) : null}

      {showtime.ticket_link ? (
        <Button asChild variant="surface" size="sm">
          <Link
            href={showtime.ticket_link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get ticket
          </Link>
        </Button>
      ) : null}

      <Button asChild variant="ghost" size="sm">
        <RouterLink
          to="/movie/$movieId"
          params={{ movieId: `${showtime.movie.id}` }}
        >
          More about this film
        </RouterLink>
      </Button>
    </Stack>
  )
}

export default ShowtimeDetailPanel
