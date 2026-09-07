/**
 * The film's description and cast.
 *
 * Both have been on `MovieDetailPublic` all along and the website rendered
 * neither, so the page named a film and then said nothing about it. The app
 * shows both.
 */
import { Stack, Text } from "@chakra-ui/react"

type MovieSynopsisProps = {
  description?: string | null
  cast?: string[] | null
}

/** Enough names to place the film, without turning the header into a credit roll. */
const CAST_SHOWN = 5

const MovieSynopsis = ({ description, cast }: MovieSynopsisProps) => {
  const leadCast = cast?.slice(0, CAST_SHOWN) ?? []

  if (!description && leadCast.length === 0) return null

  return (
    <Stack gap={2} maxW="prose" mt={2}>
      {description ? <Text fontSize="sm">{description}</Text> : null}
      {leadCast.length ? (
        <Text fontSize="sm" color="fg.muted">
          <Text as="span" fontWeight="semibold">
            Starring{" "}
          </Text>
          {leadCast.join(", ")}
        </Text>
      ) : null}
    </Stack>
  )
}

export default MovieSynopsis
