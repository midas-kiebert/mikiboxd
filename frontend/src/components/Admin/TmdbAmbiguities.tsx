/**
 * Admin feature component: TmdbAmbiguities. Lists TMDB lookups where several
 * films matched a scraped listing equally well — LAB111's "Fahrenheit 9/11"
 * tying with *Fahrenheit 11/9* is the case that prompted it. Each is a limit of
 * the matcher whether or not a tie-break then picked one, so they stay listed
 * until marked reviewed or corrected (a correction marks them reviewed too).
 */
import {
  Badge,
  Box,
  Button,
  Heading,
  Link,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { AdminService, type ApiError, type TmdbAmbiguityView } from "shared"
import TmdbCacheOverrideForm from "./TmdbCacheOverrideForm"

export const TMDB_AMBIGUITIES_QUERY_KEY = ["admin", "tmdb-ambiguities"]

const SIGNAL_LABELS: Record<string, string> = {
  prefer_stronger_title_quality: "stronger title match",
  prefer_good_year_and_runtime: "year and runtime",
  prefer_non_short: "not a short",
  prefer_non_documentary: "not a documentary",
  prefer_exact_year: "exact year",
  prefer_much_more_popular: "much more popular",
  prefer_own_title_match: "own title, not an alternative title",
}

const describeListing = (ambiguity: TmdbAmbiguityView): string =>
  [
    ambiguity.director_names.length
      ? `dir: ${ambiguity.director_names.join(", ")}`
      : null,
    ambiguity.actor_names.length
      ? `cast: ${ambiguity.actor_names.join(", ")}`
      : null,
    ambiguity.year ? `${ambiguity.year}` : "no year",
    ambiguity.duration_minutes
      ? `${ambiguity.duration_minutes} min`
      : "no runtime",
  ]
    .filter(Boolean)
    .join(" · ")

const Outcome = ({ ambiguity }: { ambiguity: TmdbAmbiguityView }) => {
  const matched = ambiguity.candidates.find(
    (candidate) => candidate.tmdb_id === ambiguity.matched_tmdb_id,
  )
  if (ambiguity.matched_tmdb_id === null) {
    return <Badge colorPalette="red">No match — screenings skipped</Badge>
  }
  const matchedLabel = matched
    ? `${matched.title}${matched.release_year ? ` (${matched.release_year})` : ""}`
    : `TMDB ${ambiguity.matched_tmdb_id}`
  if (ambiguity.is_manual_override) {
    return <Badge colorPalette="blue">Corrected by hand: {matchedLabel}</Badge>
  }
  const signals = ambiguity.resolved_by
    .map((signal) => SIGNAL_LABELS[signal] ?? signal)
    .join(", ")
  return (
    <Badge colorPalette="orange">
      Matched {matchedLabel}
      {signals ? ` by ${signals}` : ""}
    </Badge>
  )
}

const AmbiguityItem = ({ ambiguity }: { ambiguity: TmdbAmbiguityView }) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const [isCorrecting, setIsCorrecting] = useState(false)

  const reviewMutation = useMutation({
    mutationFn: () =>
      AdminService.updateTmdbAmbiguity({
        cacheId: ambiguity.cache_id,
        requestBody: { reviewed: true },
      }),
    onSuccess: () => {
      showSuccessToast("Marked as reviewed.")
      queryClient.invalidateQueries({ queryKey: TMDB_AMBIGUITIES_QUERY_KEY })
    },
    onError: (err: ApiError) => handleError(err),
  })

  return (
    <Box borderWidth="1px" borderRadius="md" p={3}>
      <Stack gap={2}>
        <Stack direction="row" gap={2} align="center" wrap="wrap">
          <Text fontWeight="semibold">
            {ambiguity.title_query ?? `cache #${ambiguity.cache_id}`}
          </Text>
          <Outcome ambiguity={ambiguity} />
        </Stack>
        <Text fontSize="sm" color="fg.muted">
          Listing gave: {describeListing(ambiguity)} · cache #
          {ambiguity.cache_id} · {ambiguity.created_at.slice(0, 10)}
        </Text>
        <Stack gap={0}>
          <Text fontSize="sm">Tied at {ambiguity.quality}:</Text>
          {ambiguity.candidates.map((candidate) => (
            <Text key={candidate.tmdb_id} fontSize="sm">
              <Link
                href={`https://www.themoviedb.org/movie/${candidate.tmdb_id}`}
                target="_blank"
                rel="noreferrer"
                fontWeight={
                  candidate.tmdb_id === ambiguity.matched_tmdb_id
                    ? "semibold"
                    : undefined
                }
              >
                {candidate.title}
                {candidate.release_year ? ` (${candidate.release_year})` : ""}
              </Link>{" "}
              · TMDB {candidate.tmdb_id}
            </Text>
          ))}
        </Stack>
        <Stack direction="row" gap={2}>
          <Button
            size="xs"
            onClick={() => reviewMutation.mutate()}
            loading={reviewMutation.isPending}
          >
            Mark reviewed
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setIsCorrecting(!isCorrecting)}
          >
            {isCorrecting ? "Cancel correction" : "Correct match"}
          </Button>
        </Stack>
        {isCorrecting && (
          <TmdbCacheOverrideForm
            defaultTitleQuery={ambiguity.title_query ?? ""}
            onSuccess={() => {
              setIsCorrecting(false)
              queryClient.invalidateQueries({
                queryKey: TMDB_AMBIGUITIES_QUERY_KEY,
              })
            }}
          />
        )}
      </Stack>
    </Box>
  )
}

const TmdbAmbiguities = () => {
  const { data: ambiguities, isLoading } = useQuery({
    queryKey: TMDB_AMBIGUITIES_QUERY_KEY,
    queryFn: () => AdminService.listTmdbAmbiguities(),
  })

  return (
    <Box mb={8}>
      <Stack direction="row" gap={2} align="center" mb={2}>
        <Heading size="md">Ambiguous TMDB matches</Heading>
        {ambiguities && ambiguities.length > 0 && (
          <Badge colorPalette="orange">{ambiguities.length} to review</Badge>
        )}
      </Stack>
      <Text color="fg.muted" mb={3}>
        Lookups where several films matched a scraped listing equally well. The
        listing alone couldn't tell them apart, even when a tie-break picked one
        — check the pick, then mark it reviewed or correct it.
      </Text>
      {isLoading || !ambiguities ? (
        <Text>Loading ambiguous matches…</Text>
      ) : ambiguities.length === 0 ? (
        <Text>Nothing to review.</Text>
      ) : (
        <Stack gap={3}>
          {ambiguities.map((ambiguity) => (
            <AmbiguityItem key={ambiguity.cache_id} ambiguity={ambiguity} />
          ))}
        </Stack>
      )}
    </Box>
  )
}

export default TmdbAmbiguities
