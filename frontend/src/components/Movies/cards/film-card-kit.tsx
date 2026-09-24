/**
 * The facts a film row states, and the one piece it draws that is not the
 * plate (`FilmPlate.tsx`).
 *
 * A film row answers different questions than a showtime card does. A
 * screening is one time at one cinema; a film is a *programme* — several
 * times, on several days, at several venues, for as long as it runs. So the
 * facts here are aggregates (when it stops playing, how many screenings there
 * are altogether) rather than the fields of one row.
 *
 * Same rules as `Showtimes/cards/card-parts`, for the same measured reason:
 * plain elements and one stylesheet, never Chakra style props, because a feed
 * draws these hundreds of times. Where a piece is already drawn by the
 * showtime cards — a friend's face, a poster's placeholder — this reuses their
 * classes instead of restating them, so a cinema's colour and a friend's ring
 * are the same thing on both feeds.
 */
import type {
  CinemaPublic,
  MovieSummaryPublic,
  ShowtimeInMoviePublic,
  UserPublic,
} from "shared"
import { isSyntheticMovieId } from "shared/movies/synthetic-movie"
import { relativeDayLabel } from "shared/showtimes/day-label"

import { UnknownPoster } from "@/components/Showtimes/cards/card-parts"
import { currentDay } from "@/features/showtimes/day-clock"
import { posterSizes, posterSrcSet } from "@/features/showtimes/poster-sources"

import type { ReactNode, SyntheticEvent } from "react"

import "./film-cards.css"

/** What the film row takes. */
export type FilmCardProps = {
  movie: MovieSummaryPublic
  /** The screening picked out of this row's plates, when one is. */
  selectedTimeId?: number | null
  onSelectTime?: (time: FilmTime) => void
}

// ---------------------------------------------------------------------------
// Derived facts.
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/**
 * Read straight off the string, like `card-parts`' `when`: showtimes are
 * zone-less wall-clock times, so the digits already are the time to print,
 * and parsing a page of them through Luxon was measured.
 */
const parseWallClock = (datetime: string) => {
  const match = WALL_CLOCK.exec(datetime)
  const [, year, month, day, hour, minute] = match ?? [
    "",
    "1970",
    "01",
    "01",
    "00",
    "00",
  ]
  return {
    date: new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ),
    time: `${hour}:${minute}`,
  }
}

const writtenDate = (date: Date) =>
  `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`

/** One screening of this film, as a plate prints it. */
export type FilmTime = {
  id: number
  time: string
  date: Date
  /**
   * "Today", "Tonight", "Tomorrow", "Sat 26 Sep" — the day, written out.
   *
   * The month is in it because a feed spanning a fortnight has two Saturdays,
   * and "Sat 26" is only unambiguous to someone who already knew which one you
   * meant. "Tonight" is the rule in `shared/showtimes/day-label`: a screening
   * in the small hours belongs to the evening you are standing in, not to the
   * date on its ticket.
   */
  datePlate: string
  cinema: CinemaPublic
  showtime: ShowtimeInMoviePublic
}

/**
 * The film's screenings, soonest first.
 *
 * Sorted here rather than trusted: the summary carries at most ten of them
 * (`showtime_limit` in the backend's converter) and the row prints the first
 * few off the front of this list.
 */
export const timesOf = (movie: MovieSummaryPublic): FilmTime[] => {
  // One day for every row on the page — see `day-clock`. The row holds the
  // subscription; this only reads it.
  const day = currentDay()
  return (movie.showtimes ?? [])
    .map((showtime) => {
      const { date, time } = parseWallClock(showtime.datetime)
      return {
        id: showtime.id,
        time,
        date,
        datePlate: relativeDayLabel(date, day) ?? writtenDate(date),
        cinema: showtime.cinema,
        showtime,
      }
    })
    .sort((left, right) => left.date.getTime() - right.date.getTime())
}

export const originalTitleOf = (movie: MovieSummaryPublic): string | null => {
  const original = movie.original_title
  return original && original.trim() !== movie.title.trim()
    ? original.trim()
    : null
}

/** Year, runtime, director — whichever of them this film actually has. */
export const metaOf = (
  movie: Pick<MovieSummaryPublic, "release_year" | "duration" | "directors">,
): string[] =>
  [
    movie.release_year ? String(movie.release_year) : null,
    movie.duration ? `${movie.duration} min` : null,
    movie.directors?.length ? movie.directors.slice(0, 2).join(", ") : null,
  ].filter((part): part is string => Boolean(part))

/**
 * How long you still have: "until Sun 5 Oct".
 *
 * A film's own deadline is the one fact a feed of screenings can never show,
 * and it is what decides whether you can leave this one for next week.
 */
export const runsUntilOf = (movie: MovieSummaryPublic): string | null => {
  if (!movie.last_showtime_datetime) return null
  const { date } = parseWallClock(movie.last_showtime_datetime)
  const relative = relativeDayLabel(date, currentDay())
  return relative ? relative.toLowerCase() : writtenDate(date)
}

/** "14 screenings · 5 cinemas", in the pieces so a row can place them. */
export const countsOf = (movie: MovieSummaryPublic) => ({
  times: movie.total_showtimes ?? movie.showtimes?.length ?? 0,
  cinemas: movie.cinemas?.length ?? 0,
})

/**
 * Your own Letterboxd marks on this film.
 *
 * **The API does not send these yet.** `MovieSummaryViewerState` carries
 * `going` and the two friend lists and nothing else, while the feed's own
 * filters (`watchlistOnly`, `hideWatched`, `watchedOnly`) prove the backend
 * knows both. So the read is written against the fields it wants, defaulting
 * to false, and the marks appear the day `viewer.watchlisted` and
 * `viewer.watched` are added to that schema — see CLEANUP.md. The samples set
 * them, so the row can be judged in the meantime.
 */
type ViewerWatchState = {
  watchlisted?: boolean | null
  watched?: boolean | null
}

export const watchOf = (movie: MovieSummaryPublic) => {
  const viewer = movie.viewer as
    | (ViewerWatchState & { going?: unknown })
    | null
    | undefined
  return {
    watchlisted: Boolean(viewer?.watchlisted),
    watched: Boolean(viewer?.watched),
  }
}

export type FilmPerson = {
  key: string
  user: Pick<UserPublic, "id" | "display_name" | "avatar_url">
  kind: "going" | "interested"
}

/**
 * Friends going to or interested in *this screening*.
 *
 * The distinction is the whole point of putting faces on a plate: friends on
 * a film tell you they like the look of it; two friends on Thursday's eight
 * o'clock tell you which showing to book.
 */
export const audienceOfTime = (
  showtime: ShowtimeInMoviePublic,
): FilmPerson[] => {
  const viewer = showtime.viewer
  if (!viewer) return []
  return [
    ...(viewer.friends_going ?? []).map((user) => ({
      key: `g-${user.id}`,
      user,
      kind: "going" as const,
    })),
    ...(viewer.friends_interested ?? []).map((user) => ({
      key: `i-${user.id}`,
      user,
      kind: "interested" as const,
    })),
  ]
}

// ---------------------------------------------------------------------------
// Pieces.
// ---------------------------------------------------------------------------

/** Hides a broken `<img>` in place, so what is underneath shows through. */
export const hideOnError = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.display = "none"
}

/** The film's poster, a coloured block while it loads or when there is none. */
export const FilmPoster = ({
  movie,
  width,
  height,
  radius = "6px",
  children,
}: {
  movie: MovieSummaryPublic
  width: string
  height?: string
  radius?: string
  children?: ReactNode
}) => (
  <span
    className={`mk-poster${height ? "" : " mk-poster--ratio"}`}
    style={{ width, height, borderRadius: radius }}
  >
    {isSyntheticMovieId(movie.id) ? (
      <UnknownPoster />
    ) : movie.poster_link ? (
      <img
        src={movie.poster_link}
        // Sharper TMDB sizes for a big card or a dense screen.
        srcSet={posterSrcSet(movie.poster_link)}
        sizes={posterSizes(width)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={hideOnError}
      />
    ) : null}
    {children}
  </span>
)
