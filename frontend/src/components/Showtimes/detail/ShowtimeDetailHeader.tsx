/**
 * The top of the showtime panel: which film, when, where.
 *
 * Laid out as the app's sheet lays it out — poster on the left with "More info"
 * directly beneath it, and the film and the screening stacked in the column
 * beside it. "More info" sits under the poster rather than among the actions at
 * the bottom for the app's reason: the link belongs to the thing it is more
 * information about, instead of competing with the title for the text column's
 * width.
 *
 * The app also tucks the Letterboxd watch counts into a narrow column up here,
 * where they are an icon and a number you have to tap to read. A desktop column
 * has room the sheet does not, so on the web they are spelled out by name in
 * the audience box instead (`detail/ShowtimeAttendance`).
 *
 * Sticky inside the panel's own scroller, so scrolling down to the seat map or
 * the invite list never leaves you wondering which of two 20:30 screenings you
 * are looking at — the one thing a panel docked beside a list of near-identical
 * rows cannot afford to lose.
 *
 * The tinted strip across the top carries the state: the same green/orange the
 * row itself takes in the feed, and blue when someone has invited you and you
 * have not answered.
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import { Link as RouterLink } from "@tanstack/react-router"
import { DateTime } from "luxon"
import type { ShowtimePublic } from "shared"
import { getCinemaPaletteKey } from "shared/cinemas/cinema-color"
import { formatLanguageCode } from "shared/movies/language"
import { isSyntheticMovieId } from "shared/movies/synthetic-movie"
import { formatShowtimeTimeRange } from "shared/showtimes/showtime-time"

import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import { personName } from "@/components/Showtimes/detail/PersonAvatar"

/** The accent the panel is topped with, by what the viewer's relationship is. */
const accentColor = (showtime: ShowtimePublic): string => {
  const viewer = showtime.viewer
  if (viewer?.going === "GOING") return "app.green.border"
  if (viewer?.going === "INTERESTED") return "app.orange.border"
  if (viewer?.invited_by?.length) return "app.blue.border"
  return "transparent"
}

/**
 * The poster is the fastest way to recognise which film the panel is showing —
 * faster than reading the title, which is the whole reason a poster exists — so
 * it is given real size rather than the thumbnail it started as. Grown a second
 * time alongside the rest of the header's type, once the panel itself grew and
 * left the poster looking like the thumbnail again by comparison.
 */
const POSTER_WIDTH = { base: "100px", xl: "116px", "2xl": "128px" }

/**
 * The header's type scale. Everything here used to be sized for a ~320px
 * column and stayed there once the panel itself grew — a 460px card with an
 * 11px director line looked like the film's details had been left behind at
 * the old width. One scale rather than a size per line, so the title, the
 * credits and the screening's own facts step up together and the ranking
 * between them (title loudest, "DIRECTED BY" quietest) survives the change.
 *
 * A first pass pushed the title to 24px and the date almost as loud beside it,
 * which read as oversized rather than roomy — the two were competing rather
 * than the title leading. This is the smaller, second pass: each line a couple
 * of pixels over where it started, not a size class up.
 */
const TITLE_SIZE = { base: "16px", lg: "17px", "2xl": "18px" }
const SUBTITLE_TEXT_SIZE = { base: "12px", "2xl": "13px" }
const DATE_SIZE = { base: "14px", "2xl": "15px" }
const TIME_SIZE = { base: "13px", "2xl": "14px" }
const BADGE_TEXT_SIZE = { base: "12px" }

/** Fixed render order; codes match `app.core.enums.Language` on the backend. */
const SUBTITLE_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["nl", "NL SUBS"],
  ["en", "EN SUBS"],
]

/** A small square-cornered badge — the app's shape for a cinema and for subs. */
const HeaderBadge = ({
  bg,
  color,
  borderColor,
  children,
}: {
  bg: string
  color: string
  borderColor?: string
  children: string
}) => (
  <Flex
    align="center"
    px="6px"
    py="1px"
    borderRadius="3px"
    borderWidth="1px"
    borderColor={borderColor ?? "transparent"}
    bg={bg}
    color={color}
    fontSize={BADGE_TEXT_SIZE}
    fontWeight="600"
    lineHeight="1.4"
    maxW="100%"
    minW={0}
  >
    <Box as="span" truncate>
      {children}
    </Box>
  </Flex>
)

type ShowtimeDetailHeaderProps = {
  showtime: ShowtimePublic
}

const ShowtimeDetailHeader = ({ showtime }: ShowtimeDetailHeaderProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const movie = showtime.movie
  const isSynthetic = isSyntheticMovieId(movie.id)
  const start = DateTime.fromISO(showtime.datetime)
  const invitedBy = showtime.viewer?.invited_by ?? []

  const originalTitle =
    movie.original_title && movie.original_title.trim() !== movie.title.trim()
      ? movie.original_title.trim()
      : null

  const dateLabel = start.isValid ? start.toFormat("cccc d LLLL") : null
  const durationLabel = movie.duration ? `${movie.duration} min` : null
  const timeLabel = [
    formatShowtimeTimeRange(showtime.datetime, showtime.end_datetime, isSynthetic),
    durationLabel,
    formatLanguageCode(movie.original_language),
  ]
    .filter(Boolean)
    .join(" • ")

  const subtitles = showtime.subtitles ?? []
  const subtitleLabels = SUBTITLE_LABELS.filter(([code]) =>
    subtitles.includes(code),
  ).map(([, label]) => label)

  const cinemaPalette = `app.${getCinemaPaletteKey(showtime.cinema)}`

  // Render/output using the state and derived values prepared above.
  return (
    <Box>
      <Box h="3px" bg={accentColor(showtime)} />

      <Flex gap={3} px={3} pt={3} pb={invitedBy.length ? 2 : 3} align="flex-start">
        <Flex direction="column" align="center" gap="3px" flexShrink={0}>
          <RouterLink to="/movie/$movieId" params={{ movieId: `${movie.id}` }}>
            <Box
              w={POSTER_WIDTH}
              aspectRatio={2 / 3}
              borderRadius="6px"
              overflow="hidden"
              bg="app.posterPlaceholder"
              borderWidth="1px"
              borderColor="border.muted"
              backgroundImage={
                movie.poster_link ? `url(${movie.poster_link})` : undefined
              }
              backgroundSize="cover"
              backgroundPosition="center"
              transition="transform 160ms ease"
              _hover={{ transform: "scale(1.02)" }}
            />
          </RouterLink>

          <RouterLink to="/movie/$movieId" params={{ movieId: `${movie.id}` }}>
            <Flex align="center" gap="1px" color="app.tint">
              <Text fontSize="11px" fontWeight="600" lineHeight="1.3">
                More info
              </Text>
              <Box as={PanelIcon.chevronRight} boxSize="13px" aria-hidden />
            </Flex>
          </RouterLink>
        </Flex>

        <Flex direction="column" gap="2px" minW={0} flex="1">
          {/* Clears the close button, which the panel pins over this corner. */}
          <Text
            as="h2"
            fontSize={TITLE_SIZE}
            fontWeight="700"
            lineHeight="1.2"
            lineClamp={3}
            pe="26px"
          >
            {movie.title}
          </Text>

          {originalTitle ? (
            <Text
              fontStyle="italic"
              fontSize={SUBTITLE_TEXT_SIZE}
              color="fg.subtle"
              lineHeight="1.3"
              lineClamp={2}
            >
              {originalTitle}
            </Text>
          ) : null}

          {movie.directors?.length ? (
            <Text fontSize={SUBTITLE_TEXT_SIZE} color="fg.muted" lineHeight="1.4" truncate>
              <Box as="span" fontSize="10px" fontWeight="700" letterSpacing="0.4px">
                DIRECTED BY{" "}
              </Box>
              {movie.directors.join(", ")}
              {movie.release_year ? ` · ${movie.release_year}` : ""}
            </Text>
          ) : null}

          {dateLabel ? (
            <Text fontSize={DATE_SIZE} fontWeight="700" lineHeight="1.3" mt="2px">
              {dateLabel}
            </Text>
          ) : null}

          {timeLabel ? (
            <Text fontSize={TIME_SIZE} color="fg.muted" lineHeight="1.3">
              {timeLabel}
            </Text>
          ) : null}

          <Flex wrap="wrap" gap="4px" mt="4px" minW={0}>
            {/* `badge_bg_color` is a palette key, not a colour — resolved
                through the shared rule so this venue is the same colour here
                as on its badge in the feed and in the app. */}
            <RouterLink
              to="/cinema-showtimes/$cinemaId"
              params={{ cinemaId: `${showtime.cinema.id}` }}
              style={{ minWidth: 0, maxWidth: "100%" }}
            >
              <HeaderBadge
                bg={`${cinemaPalette}.primary`}
                color={`${cinemaPalette}.secondary`}
                borderColor={`${cinemaPalette}.border`}
              >
                {showtime.cinema.name}
              </HeaderBadge>
            </RouterLink>

            {showtime.room ? (
              <HeaderBadge bg="app.surfaceMuted" color="fg.muted">
                {showtime.room}
              </HeaderBadge>
            ) : null}

            {subtitleLabels.map((label) => (
              <HeaderBadge key={label} bg="app.surfaceMuted" color="fg.muted">
                {label}
              </HeaderBadge>
            ))}
          </Flex>
        </Flex>

      </Flex>

      {/*
        An open invite is the one thing here that is addressed to *you* rather
        than describing the screening, so it gets its own tinted strip instead
        of a line among the metadata. The app's wording and its mail icon.
      */}
      {invitedBy.length ? (
        <Flex
          align="center"
          gap="6px"
          mx={3}
          mb={3}
          px="8px"
          py="6px"
          borderRadius="8px"
          bg="app.blue.primary"
          color="app.blue.secondary"
        >
          <Box as={PanelIcon.mailOutline} boxSize="16px" flexShrink={0} aria-hidden />
          <Text fontSize="12px" fontWeight="600" lineHeight="1.3" truncate>
            {invitedBy.length === 1
              ? `${personName(invitedBy[0])} invited you.`
              : `${personName(invitedBy[0])} and ${invitedBy.length - 1} more invited you.`}
          </Text>
        </Flex>
      ) : null}
    </Box>
  )
}

export default ShowtimeDetailHeader
