/**
 * Settings → Digest.
 *
 * A digest source is one standing question — "email me when something from this
 * list turns up at these cinemas" — and an account can have several. The
 * frequency labels come from the backend rather than being written here, so the
 * two clients and the emails themselves always agree on what "weekly or urgent"
 * means.
 */
import { useState } from "react"
import {
  Container,
  Flex,
  Heading,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DigestFrequency } from "shared"
import { MeService, UtilsService } from "shared/client"
import { useCinemaPresets } from "shared/filters/cinema-presets"
import { useFetchLetterboxdLists } from "shared/hooks/useLetterboxdLists"

import { useIsSignedIn } from "@/auth/useSession"
import { Button } from "@/components/ui/button"

const sourcesQueryKey = ["me", "watchlist-digest-sources"] as const

const WatchlistDigest = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()

  const { data: sources } = useQuery({
    queryKey: sourcesQueryKey,
    queryFn: () => MeService.getWatchlistDigestSources(),
    enabled: isSignedIn,
  })

  // Written by the backend so the app, the website and the email itself cannot
  // describe the same cadence differently.
  const { data: frequencyInfo } = useQuery({
    queryKey: ["watchlist-digest-frequency-info"],
    queryFn: () => UtilsService.getWatchlistDigestFrequencyInfo(),
    staleTime: Number.POSITIVE_INFINITY,
  })

  const { data: lists } = useFetchLetterboxdLists(isSignedIn)
  const { data: presets = [] } = useCinemaPresets({ enabled: isSignedIn })

  const [frequency, setFrequency] = useState<DigestFrequency>("weekly_or_urgent")
  const [listId, setListId] = useState<string>("")
  const [presetId, setPresetId] = useState<string>("")

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: sourcesQueryKey })

  const { mutate: add, isPending: isAdding } = useMutation({
    mutationFn: () =>
      MeService.createWatchlistDigestSource({
        requestBody: {
          frequency,
          list_id: listId || null,
          cinema_preset_id: presetId || null,
        },
      }),
    onSuccess: refresh,
  })

  const { mutate: setSourceFrequency } = useMutation({
    mutationFn: (variables: { sourceId: string; frequency: DigestFrequency }) =>
      MeService.updateWatchlistDigestSource({
        sourceId: variables.sourceId,
        requestBody: { frequency: variables.frequency },
      }),
    onSuccess: refresh,
  })

  const { mutate: remove } = useMutation({
    mutationFn: (sourceId: string) =>
      MeService.deleteWatchlistDigestSource({ sourceId }),
    onSuccess: refresh,
  })

  const describeSource = (listIdValue: string | null, presetIdValue: string | null) => {
    const list = lists?.find((entry) => entry.id === listIdValue)
    const preset = presets.find((entry) => entry.id === presetIdValue)
    return [
      list ? (list.title ?? list.list_slug) : "Your watchlist",
      preset ? preset.name : "your usual cinemas",
    ].join(" · ")
  }

  const frequencyLabel = (value: DigestFrequency) =>
    frequencyInfo?.[value]?.label ?? value

  // Render/output using the state and derived values prepared above.
  return (
    <Container maxW="full">
      <Heading size="sm" py={4}>
        Digest emails
      </Heading>

      <Text color="fg.muted" mb={4} maxW="prose">
        Get an email when something you want to see turns up. Each line below is
        one standing question — a list, a set of cinemas, and how often to ask.
      </Text>

      <Stack gap={2} maxW="lg" mb={6}>
        {sources?.length ? (
          sources.map((source) => (
            <Flex key={source.id} align="center" justify="space-between" gap={3}>
              <Stack gap={0} minW={0}>
                <Text fontSize="sm" truncate>
                  {describeSource(source.list_id, source.cinema_preset_id)}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {frequencyLabel(source.frequency)}
                </Text>
              </Stack>
              <Flex gap={1} flexShrink={0}>
                <NativeSelect.Root size="xs" width="150px">
                  <NativeSelect.Field
                    aria-label="How often"
                    value={source.frequency}
                    onChange={(event) =>
                      setSourceFrequency({
                        sourceId: source.id,
                        frequency: event.target.value as DigestFrequency,
                      })
                    }
                  >
                    <option value="daily">{frequencyLabel("daily")}</option>
                    <option value="weekly_or_urgent">
                      {frequencyLabel("weekly_or_urgent")}
                    </option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <Button
                  size="xs"
                  variant="surface"
                  colorPalette="red"
                  onClick={() => remove(source.id)}
                >
                  Remove
                </Button>
              </Flex>
            </Flex>
          ))
        ) : (
          <Text color="fg.muted" fontSize="sm">
            No digests yet.
          </Text>
        )}
      </Stack>

      <Heading size="xs" mb={2}>
        Add a digest
      </Heading>
      <Flex gap={2} wrap="wrap" align="flex-end" maxW="lg">
        <NativeSelect.Root size="sm" width="200px">
          <NativeSelect.Field
            aria-label="Which films"
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          >
            <option value="">Your watchlist</option>
            {lists?.map((list) => (
              <option key={list.id} value={list.id}>
                {list.title ?? list.list_slug}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <NativeSelect.Root size="sm" width="200px">
          <NativeSelect.Field
            aria-label="Which cinemas"
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
          >
            <option value="">Your usual cinemas</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <NativeSelect.Root size="sm" width="170px">
          <NativeSelect.Field
            aria-label="How often"
            value={frequency}
            onChange={(event) =>
              setFrequency(event.target.value as DigestFrequency)
            }
          >
            <option value="daily">{frequencyLabel("daily")}</option>
            <option value="weekly_or_urgent">
              {frequencyLabel("weekly_or_urgent")}
            </option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <Button size="sm" loading={isAdding} onClick={() => add()}>
          Add
        </Button>
      </Flex>

      {frequencyInfo ? (
        <Text fontSize="xs" color="fg.muted" mt={3} maxW="prose">
          {frequencyInfo[frequency]?.description}
        </Text>
      ) : null}
    </Container>
  )
}

export default WatchlistDigest
