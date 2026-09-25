/**
 * The films feed's card: one film to a row — the poster, what the film is, and
 * its next screenings as pressable plates.
 *
 * It is the whole feed; a wall-of-tickets treatment was tried and dropped
 * ("remove the wall option for movies, the rows are better"). A film is not
 * one time at one place, so a card that only names the next screening makes
 * you open the film to find out whether there is a better one — and on this
 * feed there almost always is. A row is wide enough to answer that where you
 * stand: six screenings, each naming its venue, its day and when it starts,
 * who is going and whether the room is filling up.
 *
 * **Nothing here is clickable except the things that do something.** The row
 * itself is inert — the poster goes to the film's page, a plate opens that
 * screening in the panel, and the three buttons under it go to Letterboxd, to
 * the film's page for the screenings that did not fit, and to the clipboard.
 * A row-wide click target swallowed all of that and left no way to *look* at a
 * row without opening something.
 *
 * The shape is the showtime wall's ticket turned on its side: the tear runs
 * down between the poster and the film, with a notch punched out of the top
 * and bottom edges where it meets them.
 */
import { Link } from "@tanstack/react-router"
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { getFriendWatchKindCopy } from "shared/friends/friend-watch-kind"

import { TicketRoot } from "@/components/Showtimes/cards/TicketRoot"
import { paletteClass } from "@/components/Showtimes/cards/card-parts"
import {
  PanelIcon,
  WATCH_KIND_ICON,
} from "@/components/Showtimes/detail/panel-icons"
import { useDayClock } from "@/features/showtimes/day-clock"
import { useUnfilteredLinks } from "@/features/showtimes/unfiltered-links"
import "@/components/Showtimes/cards/PortraitTicketCard.css"

import { Plate, plateWidth } from "./FilmPlate"
import {
  type FilmCardProps,
  FilmPoster,
  countsOf,
  metaOf,
  originalTitleOf,
  runsUntilOf,
  timesOf,
  watchOf,
} from "./film-card-kit"

/** How the feed of rows is laid out. */
export const FILM_ROW_LAYOUT = {
  /** Keeps the feed from becoming a ribbon on an ultrawide monitor. */
  maxWidth: 1044,
  /**
   * The narrowest a row still reads well at: poster, a title and two plates
   * abreast. Below it the filter rail folds away (`FeedLayout`'s
   * `minListWidth`) rather than squeezing the row further.
   */
  minWidth: 440,
  gap: 10,
}

/**
 * Plates in a row: never more than fit one line of them, so the screenings
 * are a *row* of times you read across rather than a block you read down —
 * which is the difference between a card you scan and a timetable you study,
 * and what keeps the row no taller than its poster. Where there are more than
 * fit, the last slot becomes a "+N" tile to the film's page rather than a
 * plate that would wrap the row onto a second line.
 *
 * How many fit is the plate grid's own column count (`auto-fill` at the
 * plate's minimum width, which shrinks with the row — `film-cards.css`),
 * read back after layout. Six until then, which is what a full-width row
 * holds.
 *
 * Watched on the film's column rather than on the grid: the column is always
 * there, so a count taken mid-resize — the window halved, the list squeezed
 * for a frame before the filter rail folds away — is always taken again once
 * the layout settles. Watching the grid, a row that counted one slot in that
 * frame had nothing left to watch and stayed that way.
 */
// A full-width row until measured: 500px of plates at 1px a row pixel.
const DEFAULT_ROOM = { width: 500, plateWidth: 96 }

/**
 * The plates' line: its width, and a standard plate's width at this row's
 * size, read off an invisible probe that is exactly one plate wide (the row
 * pixel `--fr-u` is a container-query length, which only layout resolves).
 */
const usePlateRoom = () => {
  const infoRef = useRef<HTMLDivElement>(null)
  const platesRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(DEFAULT_ROOM)
  useLayoutEffect(() => {
    const info = infoRef.current
    if (!info) return
    const update = () => {
      const plates = platesRef.current
      const probe = probeRef.current
      if (!plates || !probe) return
      const next = { width: plates.clientWidth, plateWidth: probe.offsetWidth }
      if (next.plateWidth <= 0) return
      setRoom((current) =>
        current.width === next.width && current.plateWidth === next.plateWidth
          ? current
          : next,
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(info)
    return () => observer.disconnect()
  }, [])
  return { infoRef, platesRef, probeRef, room }
}

/**
 * The synopsis gets every whole line of the height left over once the rest of
 * the column is laid out — measured, not guessed. Fixed container-height
 * thresholds had to budget for the worst row (a two-line title, an original
 * title, a cast line), so a row with none of those still cut its synopsis to
 * a line or two above a gap it could have filled.
 *
 * The room is from the synopsis's top to the top of whatever follows it (the
 * plates, pushed down by an auto margin), so it is the same whatever the
 * clamp currently is and setting it never feeds back into the measurement.
 * Written straight to the element's style: it is layout, not state.
 */
const useSynopsisFit = (infoRef: RefObject<HTMLDivElement | null>) => {
  const synopsisRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const info = infoRef.current
    if (!info) return
    const update = () => {
      const synopsis = synopsisRef.current
      const next = synopsis?.nextElementSibling as HTMLElement | null
      if (!synopsis || !next) return
      const style = getComputedStyle(synopsis)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const room =
        next.offsetTop - synopsis.offsetTop - Number.parseFloat(style.marginTop)
      const lines = lineHeight > 0 ? Math.floor(room / lineHeight) : 0
      synopsis.style.display = lines > 0 ? "" : "none"
      synopsis.style.webkitLineClamp = `${Math.max(1, lines)}`
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(info)
    return () => observer.disconnect()
  }, [infoRef])
  return synopsisRef
}

/** The card's face and outline, under everything else — the wall's own. */
const FRAME = <div className="mk-wall__frame" aria-hidden />

/** How long "Copied" stays on the share button before it goes back. */
const COPIED_MS = 1600

/** Your own Letterboxd marks on the film, where you have either. */
const WatchMarks = ({
  watchlisted,
  watched,
}: { watchlisted: boolean; watched: boolean }) => {
  if (!watchlisted && !watched) return null
  // The icon, the palette and the word are `shared/friends/friend-watch-kind`'s
  // — the same three the showtime panel and the movie page mark a *friend's*
  // watchlist with, so the relationship looks the same whoever holds it.
  const marks = [
    watched ? getFriendWatchKindCopy("watched") : null,
    watchlisted ? getFriendWatchKindCopy("watchlisted") : null,
  ].filter((mark) => mark !== null)

  return (
    <span className="fr-film__marks">
      {marks.map((mark) => {
        const Icon = WATCH_KIND_ICON[mark.icon]
        return (
          <span
            key={mark.kind}
            className={`fr-film__mark ${paletteClass(mark.palette)}`}
          >
            <Icon className="fr-film__mark-icon" aria-hidden />
            <span className="fr-film__mark-label">{mark.title}</span>
          </span>
        )
      })}
    </span>
  )
}

const FilmRow = ({
  movie,
  selectedTimeId = null,
  onSelectTime,
}: FilmCardProps) => {
  // Held rather than read: a row prints days, and without a hold on the page's
  // day it would keep the label it was last rendered with when the day turns
  // over — so a feed crossing midnight would relabel itself a row at a time.
  useDayClock()

  const [copied, setCopied] = useState(false)
  // Carries the feed's screening filters onto the film's page.
  const links = useUnfilteredLinks()
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const moviePath = `/movie/${movie.id}`
  const handleShare = useCallback(() => {
    // What you share is the film's own page. Optimistic — the button says
    // "Copied" on the press and the write settles behind it.
    setCopied(true)
    void navigator.clipboard
      ?.writeText(`${window.location.origin}${moviePath}`)
      .catch(() => setCopied(false))
  }, [moviePath])

  const times = timesOf(movie)
  const { infoRef, platesRef, probeRef, room } = usePlateRoom()
  const synopsisRef = useSynopsisFit(infoRef)
  // Plates are a standard width, and one whose label won't fit grows by
  // just what it needs (`plateWidth`). The line holds what fits across it;
  // whenever that isn't all of them, the last plate's room goes to the "+N"
  // tile instead of a plate wrapping the row onto a second line. Never fewer
  // than one plate, though: a row too narrow for two still shows its next
  // screening beside the tile.
  const gap = (room.plateWidth / 96) * 5
  const widths = times.map((time) => plateWidth(time, room.plateWidth))
  const fitCount = (available: number) => {
    let used = 0
    let count = 0
    for (const width of widths) {
      const next = used + (count > 0 ? gap : 0) + width
      if (next > available) break
      used = next
      count += 1
    }
    return count
  }
  const hasOverflow = fitCount(room.width) < times.length
  const shown = times.slice(
    0,
    hasOverflow
      ? Math.max(1, fitCount(room.width - room.plateWidth - gap))
      : times.length,
  )
  const hiddenCount = times.length - shown.length
  const counts = countsOf(movie)
  const until = runsUntilOf(movie)
  const meta = metaOf(movie)
  const originalTitle = originalTitleOf(movie)
  const cast = movie.cast?.length ? movie.cast.slice(0, 4).join(", ") : null
  const watch = watchOf(movie)

  // Its own page where the film has a Letterboxd slug, a search for it where
  // it does not — the same fallback the movie page itself uses.
  const letterboxdUrl = movie.letterboxd_slug
    ? `https://letterboxd.com/film/${movie.letterboxd_slug}`
    : `https://letterboxd.com/search/${encodeURIComponent(
        `${movie.title}${movie.release_year ? ` ${movie.release_year}` : ""}`,
      )}/`

  return (
    <TicketRoot className="mk-wall fr-film" shape={FRAME}>
      <Link
        to="/movie/$movieId"
        params={{ movieId: `${movie.id}` }}
        search={links.filmSearch() as never}
        className="fr-film__poster"
      >
        <FilmPoster movie={movie} width="100%" radius="6px" />
      </Link>

      {/* A zero-width item between the two columns, so the tear is wherever the
          poster ends rather than at a number this file would have to keep in
          step with the poster's width. */}
      <div className="fr-film__seam" aria-hidden />

      <div className="fr-film__info" ref={infoRef}>
        <div className="fr-film__head">
          <div className="fr-film__titles">
            <div className="fr-film__title">{movie.title}</div>
            {originalTitle ? (
              <div className="fr-film__original mk-ellipsis">
                {originalTitle}
              </div>
            ) : null}
          </div>
          <WatchMarks watchlisted={watch.watchlisted} watched={watch.watched} />
        </div>

        {meta.length ? (
          <div className="fr-film__meta mk-ellipsis">{meta.join(" · ")}</div>
        ) : null}
        {cast ? <div className="fr-film__cast mk-ellipsis">{cast}</div> : null}
        {movie.description ? (
          <p className="fr-film__synopsis" ref={synopsisRef}>
            {movie.description}
          </p>
        ) : null}

        {/* On the film having screenings, never on how many fit: the message
            says the *filters* left none, so it must not stand in for a row
            that is only short of room. */}
        {times.length ? (
          <div className="fr-film__plates" ref={platesRef}>
            <div className="fr-film__plate-probe" ref={probeRef} aria-hidden />
            {shown.map((time) => (
              <Plate
                key={time.id}
                time={time}
                isSelected={time.id === selectedTimeId}
                onSelect={onSelectTime}
              />
            ))}
            {hiddenCount > 0 ? (
              <Link
                to="/movie/$movieId"
                params={{ movieId: `${movie.id}` }}
                search={links.filmSearch() as never}
                className="fc-plate fc-plate--more"
                title={`${hiddenCount} more screening${hiddenCount === 1 ? "" : "s"} on the film's page`}
              >
                <span className="fc-plate__more-num">+{hiddenCount}</span>
                <span className="fc-plate__more-label">
                  more
                  <PanelIcon.arrowForward
                    className="fc-plate__more-arrow"
                    aria-hidden
                  />
                </span>
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="fr-film__none">No screenings in these filters</div>
        )}

        <div className="fr-film__foot">
          <span className="fr-film__counts mk-ellipsis">
            {[
              `${counts.times} screening${counts.times === 1 ? "" : "s"}`,
              counts.cinemas
                ? `${counts.cinemas} cinema${counts.cinemas === 1 ? "" : "s"}`
                : null,
              until ? `until ${until}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>

          <span className="fr-film__actions">
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
            <Link
              to="/movie/$movieId"
              params={{ movieId: `${movie.id}` }}
              search={links.filmSearch() as never}
              className="fr-act"
              title="Every screening of this film"
            >
              <PanelIcon.arrowForward className="fr-act__icon" aria-hidden />
              <span className="fr-act__label">All screenings</span>
            </Link>
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
          </span>
        </div>
      </div>
    </TicketRoot>
  )
}

export default FilmRow
