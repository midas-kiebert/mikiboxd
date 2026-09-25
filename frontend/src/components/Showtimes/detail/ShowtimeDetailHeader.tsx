/**
 * The top of the showtime panel: which film, when, where.
 *
 * Laid out with the poster on the left and the film and the screening stacked
 * in the column beside it. "More info" sits at the bottom of that column
 * rather than under the poster, so nothing but the poster itself occupies the
 * poster's own column.
 *
 * The Letterboxd watch counts live up here too, as they do in the app — two
 * small pills under the badges ("3 watchlisted"), each opening the names in a
 * popup (`detail/FriendWatchPills`). The poster is taller than the text beside
 * it, so the pills sit in room the header already has rather than adding a
 * line to the panel.
 *
 * Sticky inside the panel's own scroller, so scrolling down to the seat map or
 * the invite list never leaves you wondering which of two 20:30 screenings you
 * are looking at — the one thing a panel docked beside a list of near-identical
 * rows cannot afford to lose.
 *
 * The state is a wash of colour down from the top, as the app's sheet has it:
 * green going, orange interested, blue when someone has invited you and you
 * have not answered. Solid for the first quarter, fading out by the header's
 * foot, at the app's own strength in each mode. It replaced a 3px strip that
 * was easy to miss — and which of your screenings this is, is the first thing
 * the panel has to say.
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import { Link as RouterLink } from "@tanstack/react-router"
import { DateTime } from "luxon"
import type { ShowtimePublic } from "shared"
import {
  FESTIVAL_TAG_TEXT,
  getCinemaPaletteKey,
} from "shared/cinemas/cinema-color"
import { formatLanguageCode } from "shared/movies/language"
import { isSyntheticMovieId } from "shared/movies/synthetic-movie"
import { formatShowtimeTimeRange } from "shared/showtimes/showtime-time"

import {
  UnknownPoster,
  tokenVar,
} from "@/components/Showtimes/cards/card-parts"
import FriendWatchPills from "@/components/Showtimes/detail/FriendWatchPills"
import {
  PersonAvatar,
  personName,
} from "@/components/Showtimes/detail/PersonAvatar"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import { cinemaFeedSearch } from "@/features/showtimes/feed-params"
import { useUnfilteredLinks } from "@/features/showtimes/unfiltered-links"

/** The palette the header is washed with, by what the viewer's relationship is. */
const accentPalette = (showtime: ShowtimePublic): string | null => {
  const viewer = showtime.viewer
  if (viewer?.going === "GOING") return "green"
  if (viewer?.going === "INTERESTED") return "orange"
  if (viewer?.invited_by?.length) return "blue"
  return null
}

/**
 * The wash itself, on the app's `LinearGradient` (`ShowtimeActionModal`): the
 * palette's colour held at the top, then faded out down the header.
 *
 * Stronger than the app's at the top, on request. Light mode's `primary` is a
 * pale fill tuned for a phone sheet, and on a white panel beside a bright list
 * it read as barely tinted — so the top starts from a mix with the trio's
 * `border` step, the saturated one. Dark mode's `primary` is already a deep
 * green/orange, so it is used as-is, just less watered down than the app's
 * 45%. (Dark's `border` is the pale ink, which would wash the header out.)
 */
const washBackground = (palette: string) => {
  const primary = tokenVar(`app.${palette}.primary`)
  const border = tokenVar(`app.${palette}.border`)
  return {
    background: `linear-gradient(to bottom, color-mix(in srgb, ${border} 55%, ${primary}) 0%, ${primary} 40%, transparent 100%)`,
    _dark: {
      background: `linear-gradient(to bottom, ${primary} 0%, ${primary} 35%, transparent 100%)`,
      opacity: 0.85,
    },
  }
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
    // A pixel more above than below: centred on its line box, the ink sat high.
    pt="2px"
    pb="0"
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
  const links = useUnfilteredLinks()
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
    formatShowtimeTimeRange(
      showtime.datetime,
      showtime.end_datetime,
      isSynthetic,
    ),
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
  const palette = accentPalette(showtime)

  // Render/output using the state and derived values prepared above.
  return (
    // Its own stacking context, so the wash can sit under the content (z -1)
    // without falling behind the sticky header's own background.
    <Box position="relative" isolation="isolate">
      {palette ? (
        <Box
          position="absolute"
          inset={0}
          zIndex={-1}
          pointerEvents="none"
          css={washBackground(palette)}
          aria-hidden
        />
      ) : null}

      <Flex
        gap={3}
        px={3}
        pt={3}
        pb={invitedBy.length ? 2 : 3}
        align="flex-start"
      >
        <Flex direction="column" flexShrink={0}>
          <RouterLink
            to="/movie/$movieId"
            params={{ movieId: `${movie.id}` }}
            search={links.filmSearch() as never}
            onClick={links.onFollow}
          >
            <Box
              position="relative"
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
            >
              {isSynthetic ? <UnknownPoster /> : null}
            </Box>
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
            <Text
              fontSize={SUBTITLE_TEXT_SIZE}
              color="fg.muted"
              lineHeight="1.4"
              truncate
            >
              <Box
                as="span"
                fontSize="10px"
                fontWeight="700"
                letterSpacing="0.4px"
              >
                DIRECTED BY{" "}
              </Box>
              {movie.directors.join(", ")}
              {movie.release_year ? ` · ${movie.release_year}` : ""}
            </Text>
          ) : null}

          {dateLabel ? (
            <Text
              fontSize={DATE_SIZE}
              fontWeight="700"
              lineHeight="1.3"
              mt="2px"
            >
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
              to="/"
              search={links.search(cinemaFeedSearch(showtime.cinema.id))}
              onClick={links.onFollow}
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

            {/* The festival, when the screening is part of one and plays in
                a real cinema (placed at the festival itself, the badge above
                already names it). Goes to the festival's own site. */}
            {showtime.festival &&
            showtime.festival.id !== showtime.cinema.id ? (
              <a
                href={showtime.festival.url}
                target="_blank"
                rel="noreferrer"
                style={{ minWidth: 0, maxWidth: "100%" }}
              >
                <HeaderBadge
                  bg={`app.${getCinemaPaletteKey(showtime.festival)}.secondary`}
                  color={
                    FESTIVAL_TAG_TEXT[getCinemaPaletteKey(showtime.festival)] ??
                    `app.${getCinemaPaletteKey(showtime.festival)}.primary`
                  }
                >
                  {showtime.festival.name}
                </HeaderBadge>
              </a>
            ) : null}

            {/* A festival screening the pass doesn't cover (at LIFF,
                everything outside the competitions), wherever it plays — a
                festival venue like Volkshuis included. Outside festivals only
                where it contradicts a Cineville cinema. `=== false` on
                purpose: an older API sends no flag at all. */}
            {showtime.cineville_pass === false &&
            (showtime.festival || showtime.cinema.cineville) ? (
              <HeaderBadge bg="app.surfaceMuted" color="fg.muted">
                No Cineville pass
              </HeaderBadge>
            ) : null}

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

          <FriendWatchPills showtime={showtime} />

          <RouterLink
            to="/movie/$movieId"
            params={{ movieId: `${movie.id}` }}
            search={links.filmSearch() as never}
            onClick={links.onFollow}
          >
            <Flex align="center" gap="1px" color="app.tint" mt="2px">
              <Text
                fontSize="11px"
                fontWeight="600"
                lineHeight="1.3"
                position="relative"
                top="1px"
              >
                More info
              </Text>
              <Box as={PanelIcon.chevronRight} boxSize="13px" aria-hidden />
            </Flex>
          </RouterLink>
        </Flex>
      </Flex>

      {/*
        An open invite is the one thing here that is addressed to *you* rather
        than describing the screening, so it gets its own tinted strip instead
        of a line among the metadata. It leads with the inviter's own avatar
        rather than a generic mail icon, so who asked is recognisable at a
        glance; friends going or interested still show above, as on any panel.
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
          <Box flexShrink={0} aria-hidden>
            <PersonAvatar user={invitedBy[0]} size={18} />
          </Box>
          <Text
            fontSize="12px"
            fontWeight="600"
            lineHeight="1.3"
            truncate
            position="relative"
            top="1px"
          >
            {invitedBy.length === 1
              ? `You were invited by ${personName(invitedBy[0])}.`
              : `You were invited by ${personName(invitedBy[0])} and ${invitedBy.length - 1} more.`}
          </Text>
        </Flex>
      ) : null}
    </Box>
  )
}

export default ShowtimeDetailHeader
