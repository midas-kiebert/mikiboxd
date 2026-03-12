import Page from "@/components/Common/Page"
import {
  Box,
  Button,
  Center,
  Flex,
  Heading,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import { DateTime } from "luxon"
/**
 * Pings feature component: Invites page.
 */
import { useEffect, useMemo, useState } from "react"
import {
  MeService,
  type ShowtimeLoggedIn,
  type ShowtimePingPublic,
} from "shared"
import { useFetchShowtimePings } from "shared/hooks/useFetchShowtimePings"
import ShowtimeCard from "../Showtimes/ShowtimeCard"

type PingSortMode = "ping-date" | "showtime-date"

type GroupedPingCard = {
  showtimeId: number
  showtime: ShowtimeLoggedIn
  pingIds: number[]
  senders: ShowtimePingPublic["sender"][]
  latestPingCreatedAt: string
  latestPingCreatedAtMs: number
  hasUnseen: boolean
}

const formatPingSenderSummary = (senders: GroupedPingCard["senders"]) => {
  const names = [
    ...new Set(
      senders.map((sender) => sender.display_name?.trim() || "Friend"),
    ),
  ]
  if (names.length === 0) return "Invited by Friend"
  if (names.length === 1) return `Invited by ${names[0]}`
  if (names.length === 2) return `Invited by ${names[0]} and ${names[1]}`
  return `Invited by ${names[0]} and ${names.length - 1} others`
}

const PingsPage = () => {
  // Read flow: route-level filters and query cache wiring first, then handlers and list logic.
  const queryClient = useQueryClient()
  const [sortMode, setSortMode] = useState<PingSortMode>("ping-date")
  const backendSortBy =
    sortMode === "ping-date" ? "ping_created_at" : "showtime_datetime"
  const [hiddenPingIds, setHiddenPingIds] = useState<Set<number>>(new Set())

  const {
    data: pings = [],
    isLoading,
    isFetching,
  } = useFetchShowtimePings({ sortBy: backendSortBy })

  const activePings = useMemo(
    () => pings.filter((ping) => !hiddenPingIds.has(ping.id)),
    [hiddenPingIds, pings],
  )

  const groupedPings = useMemo(() => {
    const grouped = new Map<number, GroupedPingCard>()
    for (const ping of activePings) {
      const createdAtMs = DateTime.fromISO(ping.created_at).toMillis()
      const existing = grouped.get(ping.showtime_id)

      if (!existing) {
        grouped.set(ping.showtime_id, {
          showtimeId: ping.showtime_id,
          showtime: ping.showtime,
          pingIds: [ping.id],
          senders: [ping.sender],
          latestPingCreatedAt: ping.created_at,
          latestPingCreatedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
          hasUnseen: ping.seen_at === null,
        })
        continue
      }

      if (!existing.senders.some((sender) => sender.id === ping.sender.id)) {
        existing.senders.push(ping.sender)
      }
      existing.pingIds.push(ping.id)
      if (
        Number.isFinite(createdAtMs) &&
        createdAtMs > existing.latestPingCreatedAtMs
      ) {
        existing.latestPingCreatedAtMs = createdAtMs
        existing.latestPingCreatedAt = ping.created_at
      }
      if (ping.seen_at === null) {
        existing.hasUnseen = true
      }
    }

    const groupedCards = Array.from(grouped.values())
    if (sortMode === "showtime-date") {
      return groupedCards.sort((left, right) => {
        const leftShowtimeTime = DateTime.fromISO(
          left.showtime.datetime,
        ).toMillis()
        const rightShowtimeTime = DateTime.fromISO(
          right.showtime.datetime,
        ).toMillis()
        if (leftShowtimeTime !== rightShowtimeTime) {
          return leftShowtimeTime - rightShowtimeTime
        }
        return right.latestPingCreatedAtMs - left.latestPingCreatedAtMs
      })
    }

    return groupedCards.sort(
      (left, right) => right.latestPingCreatedAtMs - left.latestPingCreatedAtMs,
    )
  }, [activePings, sortMode])

  const markSeenMutation = useMutation({
    mutationFn: () => MeService.markMyShowtimePingsSeen(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["me", "showtimePings", "unseenCount"],
      })
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] })
    },
  })

  const deletePingsMutation = useMutation({
    mutationFn: async ({ pingIds }: { pingIds: number[] }) => {
      for (const pingId of pingIds) {
        await MeService.deleteMyShowtimePing({ pingId })
      }
    },
    onMutate: ({ pingIds }) => {
      setHiddenPingIds((previous) => {
        const next = new Set(previous)
        pingIds.forEach((pingId) => next.add(pingId))
        return next
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] })
      queryClient.invalidateQueries({
        queryKey: ["me", "showtimePings", "unseenCount"],
      })
    },
  })

  useEffect(() => {
    markSeenMutation.mutate()
  }, [])

  return (
    <Page>
      <Flex align="center" justify="space-between" gap={4} mb={4}>
        <Heading size={{ base: "md", md: "lg" }}>Invites</Heading>
        <Button
          size="xs"
          onClick={() =>
            setSortMode((current) =>
              current === "ping-date" ? "showtime-date" : "ping-date",
            )
          }
        >
          Sort by {sortMode === "ping-date" ? "Showtime date" : "Invite date"}
        </Button>
      </Flex>

      {(isLoading || isFetching) && pings.length === 0 ? (
        <Center py={16}>
          <Spinner />
        </Center>
      ) : groupedPings.length === 0 ? (
        <Flex
          direction="column"
          align="center"
          gap={2}
          bg="gray.50"
          p={6}
          borderRadius="md"
          borderWidth="1px"
        >
          <Text fontWeight="600">No invites yet.</Text>
          <Text fontSize="sm" color="gray.600">
            When friends invite you to a showtime, it will show up here.
          </Text>
        </Flex>
      ) : (
        <Stack gap={4}>
          {groupedPings.map((ping) => (
            <Box
              key={ping.showtimeId}
              borderWidth="1px"
              borderRadius="md"
              borderColor="gray.200"
              overflow="hidden"
              bg="white"
            >
              <RouterLink
                to="/movie/$movieId"
                params={{ movieId: String(ping.showtime.movie.id) }}
              >
                <Box>
                  <ShowtimeCard
                    showtime={ping.showtime}
                    going_status={ping.showtime.going}
                  />
                </Box>
              </RouterLink>
              <Flex
                px={3}
                py={2}
                justify="space-between"
                align="center"
                borderTopWidth="1px"
                borderColor="gray.200"
                bg={ping.hasUnseen ? "green.50" : "gray.50"}
              >
                <Box>
                  <Text fontSize="xs" color="gray.500">
                    {formatPingSenderSummary(ping.senders)}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    Latest invite:{" "}
                    {DateTime.fromISO(ping.latestPingCreatedAt).toFormat(
                      "ccc, LLL d • HH:mm",
                    )}
                  </Text>
                </Box>
                <Button
                  size="xs"
                  colorScheme={ping.hasUnseen ? "green" : "gray"}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    deletePingsMutation.mutate({ pingIds: ping.pingIds })
                  }}
                  disabled={deletePingsMutation.isPending}
                >
                  Dismiss
                </Button>
              </Flex>
            </Box>
          ))}
        </Stack>
      )}
    </Page>
  )
}

export default PingsPage
