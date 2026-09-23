/**
 * A film's own page: everything about the film at the top, then its run.
 *
 * Laid out for what a film page is rather than as a feed row made bigger. A
 * row has to be one line in a list; a page has one film and, often, a very
 * long run — forty-odd screenings over three weeks is ordinary. So:
 *
 *   - **Everything that is not a screening sits above the run.** Title, meta,
 *     cast, synopsis, the buttons, the counts and your friends. Nothing comes
 *     after the last screening, because on a film with a long run nobody ever
 *     scrolls that far to find it — the Letterboxd and Share buttons and the
 *     "until Wed 16 Dec" line used to sit there, at the end of the row.
 *   - **The run gets the page's full width**, not the column beside the
 *     poster. That column left the poster standing over a strip of nothing as
 *     soon as the run outgrew it, which on this page it always does. The days
 *     are blocks in a grid rather than one per line, so two quiet days sit
 *     side by side instead of each taking a full-width line for one plate —
 *     it reads like a week on a calendar, left to right and then down.
 *   - **Friends are people, not counts.** The feed row can only afford two
 *     small "2 watchlisted" pills; here the header has room for the names, so
 *     "Watchlisted by" and "Watched by" are lists you can read and follow to
 *     each friend's agenda.
 *
 * The pieces are still the feed's: the same plates at the same size, the same
 * "Tonight" rule, the same watch-kind icons and colours, so a screening you
 * saw in a row is the same object here.
 *
 * Nothing is clickable except the things that do something: the poster opens
 * the film on Letterboxd, a plate opens that screening in the panel beside the
 * page, a friend's name opens their agenda, and the two buttons go to
 * Letterboxd and to the clipboard.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  CinemaPublic,
  MoviePublic,
  MovieSummaryPublic,
  UserPublic,
} from "shared"
import {
  type FriendWatchKind,
  getFriendWatchKindCopy,
} from "shared/friends/friend-watch-kind"

import { Plate } from "@/components/Movies/cards/FilmPlate"
import {
  FilmPoster,
  type FilmTime,
  countsOf,
  metaOf,
  originalTitleOf,
  runsUntilOf,
  timesOf,
} from "@/components/Movies/cards/film-card-kit"
import { paletteClass } from "@/components/Showtimes/cards/card-parts"
import { PersonChip } from "@/components/Showtimes/detail/PersonAvatar"
import {
  PanelIcon,
  WATCH_KIND_ICON,
} from "@/components/Showtimes/detail/panel-icons"
import { useDayClock } from "@/features/showtimes/day-clock"
import "./movie-detail.css"

/** How long "Copied" stays on the share button before it goes back. */
const COPIED_MS = 1600

/**
 * Enough of a cast to place the film. More than a feed row's four, which is
 * what a page has room for, and still short of a credit roll.
 */
const CAST_SHOWN = 8

/**
 * The film's screenings under the day they fall on.
 *
 * Grouped by the label a plate would have printed rather than by the calendar
 * date, because those are not the same question: a 00:30 screening is
 * "Tonight" while the 20:00 one sharing its date is "Tomorrow"
 * (`shared/showtimes/day-label`), and filing the small hours under tomorrow is
 * exactly the mistake that rule exists to prevent. The times arrive sorted, so
 * walking them in order gives the groups in order too.
 */
type FilmDay = { label: string; times: FilmTime[] }

const groupByDay = (times: FilmTime[]): FilmDay[] => {
  const days: FilmDay[] = []
  for (const time of times) {
    const current = days[days.length - 1]
    if (current && current.label === time.datePlate) current.times.push(time)
    else days.push({ label: time.datePlate, times: [time] })
  }
  return days
}

/**
 * The page's film as the film kit's helpers want it.
 *
 * The kit is written against `MovieSummaryPublic` — the feed's shape — and the
 * page is served `MoviePublic`, which is the same film with *every* matching
 * screening instead of the first handful and none of the three aggregates a
 * card prints. Those aggregates are the reason the summary carries them at
 * all: the feed cannot count what it was not sent. Here the whole run is in
 * hand, so they are counted from it rather than asked for.
 *
 * `viewer` is dropped on the way through: the two schemas mean different
 * things by it — the summary's is the viewer's own status, the page's is which
 * *friends* have the film marked — and the friends' marks are drawn by
 * `FriendWatchGroups` from the page's own data.
 */
const asFilmSummary = (movie: MoviePublic): MovieSummaryPublic => {
  const cinemas = new Map<number, CinemaPublic>()
  for (const showtime of movie.showtimes) {
    cinemas.set(showtime.cinema.id, showtime.cinema)
  }
  // Wall-clock ISO strings, so the latest one is the largest one; see
  // `parseWallClock` in the kit for why these are never parsed to instants.
  const last = movie.showtimes.reduce<string | null>(
    (latest, showtime) =>
      latest === null || showtime.datetime > latest
        ? showtime.datetime
        : latest,
    null,
  )

  return {
    id: movie.id,
    title: movie.title,
    original_title: movie.original_title,
    poster_link: movie.poster_link,
    letterboxd_slug: movie.letterboxd_slug,
    directors: movie.directors,
    cast: movie.cast,
    release_year: movie.release_year,
    duration: movie.duration,
    languages: movie.languages,
    original_language: movie.original_language,
    description: movie.description,
    showtimes: movie.showtimes,
    cinemas: [...cinemas.values()],
    last_showtime_datetime: last,
    total_showtimes: movie.showtimes.length,
    viewer: null,
  }
}

/** The film's own page where it has a Letterboxd slug, a search where it does not. */
const letterboxdUrlOf = (movie: MoviePublic) =>
  movie.letterboxd_slug
    ? `https://letterboxd.com/film/${movie.letterboxd_slug}`
    : `https://letterboxd.com/search/${encodeURIComponent(
        `${movie.title}${movie.release_year ? ` ${movie.release_year}` : ""}`,
      )}/`

/**
 * How many friends a group lists before it folds the rest behind "Show all".
 * Enough that the usual case is never folded; few enough that a film half
 * your friends have watchlisted does not push the run a screen down.
 */
const FRIENDS_SHOWN = 6

/**
 * One of the two friend lists: a heading in the watch kind's own colour and
 * icon, then the people, each a link to their agenda (`PersonChip`, the
 * showtime panel's own row).
 */
const FriendWatchGroup = ({
  kind,
  friends,
}: {
  kind: FriendWatchKind
  friends: UserPublic[]
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const copy = getFriendWatchKindCopy(kind)
  const Icon = WATCH_KIND_ICON[copy.icon]
  const hidden = friends.length - FRIENDS_SHOWN
  const shown =
    isOpen || hidden <= 0 ? friends : friends.slice(0, FRIENDS_SHOWN)

  return (
    <section className="mp-friends__group">
      <h2 className={`mp-friends__heading ${paletteClass(copy.palette)}`}>
        <Icon className="mp-friends__icon" aria-hidden />
        <span className="mp-friends__heading-label">
          {`${copy.title} by ${friends.length} ${friends.length === 1 ? "friend" : "friends"}`}
        </span>
      </h2>
      <div className="mp-friends__list">
        {shown.map((friend) => (
          <PersonChip key={friend.id} user={friend} />
        ))}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          className="fr-act mp-friends__more"
          onClick={() => setIsOpen((open) => !open)}
        >
          <span className="fr-act__label">
            {isOpen ? "Show fewer" : `Show all ${friends.length}`}
          </span>
        </button>
      ) : null}
    </section>
  )
}

/**
 * Which friends have the film watchlisted, and which have already seen it.
 *
 * Watched wins over watchlisted, the rule the showtime panel's pills follow: a
 * friend counted in both reads as two different people at a glance, and
 * having seen it is the later fact. Nothing at all when neither list has
 * anyone — a guest, or a film none of your friends have marked — and the
 * header gives the room back to the synopsis.
 */
const useFriendWatchGroups = (movie: MoviePublic) =>
  useMemo(() => {
    const watched = movie.viewer?.friends_watched ?? []
    const watchedIds = new Set(watched.map((friend) => friend.id))
    const watchlisted = (movie.viewer?.friends_watchlisted ?? []).filter(
      (friend) => !watchedIds.has(friend.id),
    )
    return [
      ...(watchlisted.length
        ? [{ kind: "watchlisted" as const, friends: watchlisted }]
        : []),
      ...(watched.length
        ? [{ kind: "watched" as const, friends: watched }]
        : []),
    ]
  }, [movie.viewer])

type MovieDetailProps = {
  movie: MoviePublic
  /** The screening the panel beside the page is open on, when there is one. */
  selectedShowtimeId?: number | null
  onSelectTime?: (time: FilmTime) => void
  /** What an empty run says — the page knows whether filters emptied it. */
  emptyText?: string
}

const MovieDetail = ({
  movie,
  selectedShowtimeId = null,
  onSelectTime,
  emptyText = "No screenings in your cinemas",
}: MovieDetailProps) => {
  // Held rather than read: this page prints days, and without a hold on the
  // page's day it would keep the label it was last rendered with when the day
  // turned over — see `day-clock`.
  useDayClock()

  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const handleShare = useCallback(() => {
    // Optimistic — the button says "Copied" on the press and the write settles
    // behind it.
    setCopied(true)
    void navigator.clipboard
      ?.writeText(window.location.href)
      .catch(() => setCopied(false))
  }, [])

  const summary = useMemo(() => asFilmSummary(movie), [movie])
  const days = useMemo(() => groupByDay(timesOf(summary)), [summary])
  const friendGroups = useFriendWatchGroups(movie)

  const counts = countsOf(summary)
  const until = runsUntilOf(summary)
  const meta = metaOf(summary)
  const originalTitle = originalTitleOf(summary)
  const cast = movie.cast?.length
    ? movie.cast.slice(0, CAST_SHOWN).join(", ")
    : null
  const letterboxdUrl = letterboxdUrlOf(movie)
  const runSummary = [
    `${counts.times} screening${counts.times === 1 ? "" : "s"}`,
    counts.cinemas
      ? `${counts.cinemas} cinema${counts.cinemas === 1 ? "" : "s"}`
      : null,
    until ? `until ${until}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <article className={`mp${friendGroups.length ? " mp--friends" : ""}`}>
      <header className="mp-head">
        <a
          className="mp-poster"
          href={letterboxdUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${movie.title} on Letterboxd`}
        >
          <FilmPoster movie={summary} width="100%" radius="8px" />
        </a>

        <div className="mp-about">
          <h1 className="mp-title">{movie.title}</h1>
          {originalTitle ? (
            <div className="mp-original">{originalTitle}</div>
          ) : null}
          {meta.length ? (
            <div className="mp-meta">{meta.join(" · ")}</div>
          ) : null}
          {cast ? <div className="mp-cast">{cast}</div> : null}
          {movie.description ? (
            <p className="mp-synopsis">{movie.description}</p>
          ) : null}

          <div className="mp-actions">
            <a
              className="fr-act"
              href={letterboxdUrl}
              target="_blank"
              rel="noreferrer"
              title="Open on Letterboxd"
            >
              <PanelIcon.letterboxd className="fr-act__icon" aria-hidden />
              <span className="fr-act__label">Letterboxd</span>
            </a>
            <button
              type="button"
              className={`fr-act${copied ? " fr-act--done" : ""}`}
              onClick={handleShare}
              title="Copy a link to this film"
            >
              {copied ? (
                <PanelIcon.check className="fr-act__icon" aria-hidden />
              ) : (
                <PanelIcon.shareLink className="fr-act__icon" aria-hidden />
              )}
              <span className="fr-act__label">
                {copied ? "Copied" : "Share"}
              </span>
            </button>
          </div>
        </div>

        {friendGroups.length ? (
          <aside className="mp-friends" aria-label="Friends">
            {friendGroups.map((group) => (
              <FriendWatchGroup
                key={group.kind}
                kind={group.kind}
                friends={group.friends}
              />
            ))}
          </aside>
        ) : null}
      </header>

      {/* The run, and the end of the page: nothing is drawn after it. Its
          summary is its heading, so how long the film still plays is read
          before the scroll starts rather than at the bottom of it. */}
      <section className="mp-run" aria-label="Screenings">
        <div className="mp-run__head">
          <h2 className="mp-run__title">Screenings</h2>
          <span className="mp-run__summary">{runSummary}</span>
        </div>

        {days.length ? (
          <div className="mp-days">
            {days.map((day) => (
              <div key={day.label} className="mp-day">
                <div className="mp-day__label">{day.label}</div>
                <div className="mp-day__plates">
                  {day.times.map((time) => (
                    <Plate
                      key={time.id}
                      time={time}
                      isSelected={time.id === selectedShowtimeId}
                      onSelect={onSelectTime}
                      // The heading above these already says which day they
                      // are, so the plate spends that line on nothing.
                      showDate={false}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mp-run__none">{emptyText}</div>
        )}
      </section>
    </article>
  )
}

export default MovieDetail
