/**
 * Admin feature component: TmdbCacheOverrideForm. Fixes the cached TMDB
 * lookup used by future scrapes of a given title, and immediately reassigns
 * every already-scraped movie/showtime that used that exact cache entry —
 * shared by the Movies tab and the per-report "fix TMDB cache" action on the
 * Reports tab.
 *
 * Corrections target a cache row by id (picked from a title search) rather
 * than by reconstructing its lookup payload, since that payload includes
 * fields (duration, spoken languages, ...) an admin can't reliably guess —
 * a mismatch there used to silently create a disconnected duplicate cache
 * entry instead of correcting the one showtimes actually reference.
 */
import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { type ApiError, type TmdbCacheSearchResult, UtilsService } from "shared"
import { Field } from "../ui/field"

type ParsedLookupPayload = {
  title_query?: string
  director_names?: string[]
  actor_names?: string[]
  year?: number | null
  duration_minutes?: number | null
  spoken_languages?: string[]
}

const describeEntry = (entry: TmdbCacheSearchResult): string => {
  let payload: ParsedLookupPayload = {}
  try {
    payload = JSON.parse(entry.lookup_payload)
  } catch {
    // fall through with an empty payload description
  }
  const parts = [
    payload.title_query,
    payload.director_names?.length
      ? `dir: ${payload.director_names.join(", ")}`
      : null,
    payload.year ? `${payload.year}` : null,
    payload.duration_minutes ? `${payload.duration_minutes}min` : null,
    payload.spoken_languages?.length
      ? payload.spoken_languages.join("/")
      : null,
  ].filter(Boolean)
  return parts.join(" · ")
}

const TmdbCacheOverrideForm = ({
  defaultTitleQuery = "",
  onSuccess,
}: {
  defaultTitleQuery?: string
  onSuccess?: () => void
}) => {
  const { showSuccessToast } = useCustomToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(defaultTitleQuery)
  const [searchTerm, setSearchTerm] = useState(defaultTitleQuery)
  const [selected, setSelected] = useState<TmdbCacheSearchResult | null>(null)
  const [newTmdbId, setNewTmdbId] = useState("")

  const { data: results, isFetching } = useQuery({
    queryKey: ["tmdb-cache-search", searchTerm],
    queryFn: () =>
      UtilsService.searchTmdbCacheEntries({ title: searchTerm }),
    enabled: searchTerm.trim().length > 0,
  })

  const mutation = useMutation({
    mutationFn: () =>
      UtilsService.correctTmdbCacheEntry({
        requestBody: {
          cache_id: selected!.id,
          tmdb_id: Number(newTmdbId),
        },
      }),
    onSuccess: () => {
      showSuccessToast("Lookup cache entry corrected.")
      queryClient.invalidateQueries({ queryKey: ["tmdb-cache-search"] })
      setSelected(null)
      setNewTmdbId("")
      onSuccess?.()
    },
    onError: (err: ApiError) => handleError(err),
  })

  return (
    <Stack gap={3} maxW="md">
      <Text fontSize="sm" color="gray.500">
        Search for the exact cache entry a title's showtimes are using, then
        correct its TMDB ID directly. Every movie/showtime already produced
        by that entry is reassigned to the corrected ID immediately.
      </Text>
      <Field label="Title as scraped">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              setSearchTerm(title)
              setSelected(null)
            }
          }}
        />
      </Field>
      <Button
        onClick={() => {
          setSearchTerm(title)
          setSelected(null)
        }}
        loading={isFetching}
        alignSelf="start"
        variant="outline"
      >
        Search cache entries
      </Button>

      {results && results.length === 0 && (
        <Text fontSize="sm" color="gray.500">
          No cache entries found for that title.
        </Text>
      )}

      {results && results.length > 0 && (
        <Stack gap={2}>
          {results.map((entry) => (
            <Box
              key={entry.id}
              borderWidth={1}
              borderColor={selected?.id === entry.id ? "blue.400" : "gray.200"}
              borderRadius="md"
              p={2}
              cursor="pointer"
              onClick={() => setSelected(entry)}
            >
              <Text fontSize="sm" fontWeight="bold">
                cache #{entry.id} → tmdb_id {entry.tmdb_id ?? "none"}
              </Text>
              <Text fontSize="xs" color="gray.500">
                {describeEntry(entry)}
              </Text>
            </Box>
          ))}
        </Stack>
      )}

      {selected && (
        <Stack gap={3} borderTopWidth={1} pt={3}>
          <Text fontSize="sm">
            Correcting cache #{selected.id} (currently tmdb_id{" "}
            {selected.tmdb_id ?? "none"})
          </Text>
          <Field label="Correct TMDB ID">
            <Input
              type="number"
              value={newTmdbId}
              onChange={(e) => setNewTmdbId(e.target.value)}
              required
            />
          </Field>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!newTmdbId}
            alignSelf="start"
          >
            Correct cache entry
          </Button>
        </Stack>
      )}
    </Stack>
  )
}

export default TmdbCacheOverrideForm
