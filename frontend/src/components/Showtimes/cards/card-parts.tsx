/**
 * The small pieces a showtime card is built from — the ticket wall's cards in
 * the feed, and the rows of `FeedOverviewPanel` beside them — so a cinema tag
 * or a friend's face is drawn the same way wherever it appears.
 *
 * The card as a whole opens the detail panel; the one thing here that links
 * anywhere on its own is `AvatarStack`'s hover list, to a friend's own agenda.
 *
 * **Plain elements and one stylesheet (`card-parts.css`), not Chakra style
 * props.** A feed renders these hundreds of times, and a page of new cards was
 * measured spending more than half its render inside Chakra's style engine —
 * props split, styles serialised and hashed, once per element per render.
 * Class names cost nothing to render. Colours still come from the theme: the
 * stylesheet reads Chakra's own CSS variables, so dark mode and the palette
 * follow without anything here knowing about them.
 *
 * One exception: `AvatarStack`'s hover list is built on Chakra's `HoverCard`.
 * It needs real positioning against the viewport (placed below and clear of
 * whichever edge the stack is near) and a portal out of the card's own
 * subtree — a card sits in a `content-visibility: auto` cell, which clips
 * paint to the cell's own box no matter how the popover itself is
 * positioned, so anything meant to escape the card has to leave that subtree
 * entirely. Reimplementing that (plus the hover-intent gap-tolerance between
 * trigger and content — the pointer has to be able to cross from one to the
 * other without the card closing under it) by hand was the CSS-only version
 * this replaced, and it could do neither. It costs nothing for a card that is
 * never hovered only because `AvatarStack` asks for that explicitly
 * (`lazyMount unmountOnExit`) — Ark UI (which `HoverCard` wraps) otherwise
 * mounts and keeps every instance's content in the DOM from the start, which
 * is exactly the per-card-up-front cost the rest of this file's hover
 * reveals are written to avoid.
 */
import { HoverCard, Portal } from "@chakra-ui/react"
import { Link, useNavigate } from "@tanstack/react-router"
import type { CSSProperties, ReactNode, SyntheticEvent } from "react"
import type { ShowtimePublic, UserPublic } from "shared"
import { getCinemaPaletteKey } from "shared/cinemas/cinema-color"
import { isSyntheticMovieId } from "shared/movies/synthetic-movie"
import { relativeDayLabel } from "shared/showtimes/day-label"
import {
  formatSeatCount,
  getSeatAvailabilityCopy,
  getSeatAvailabilityPresentation,
  isBusySeatAvailabilityLevel,
} from "shared/showtimes/seat-availability-level"
import { formatSeatLabel } from "shared/showtimes/seat-label"
import {
  getAvatarInitial,
  getAvatarPaletteKey,
} from "shared/users/avatar-color"

import {
  PanelIcon,
  SEAT_LEVEL_ICON,
} from "@/components/Showtimes/detail/panel-icons"
import { currentDay } from "@/features/showtimes/day-clock"
import {
  cinemaFeedSearch,
  friendFeedSearch,
} from "@/features/showtimes/feed-params"
import { posterSizes, posterSrcSet } from "@/features/showtimes/poster-sources"
import { useUnfilteredLinks } from "@/features/showtimes/unfiltered-links"

import "./card-parts.css"

/** What a showtime card takes. */
export type ShowtimeCardProps = {
  showtime: ShowtimePublic
  isSelected: boolean
  /** Stable across renders in the feed, so memoised cards stay put. */
  onSelect: (showtime: ShowtimePublic) => void
}

// ---------------------------------------------------------------------------
// Colours.
// ---------------------------------------------------------------------------

const kebab = (value: string) =>
  value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)

/**
 * A theme token's CSS variable, for anything written as raw CSS — gradients,
 * `color-mix`, inline styles.
 *
 * Two rules of Chakra's naming, both of which fail silently when guessed wrong
 * (an undefined variable voids the whole declaration): camelCase keys are
 * kebab-cased (`redHot` is `red-hot`), and the palette trios are registered
 * as flat keys with a dot in them, which is escaped rather than hyphenated —
 * `app.redHot.primary` is `--chakra-colors-app-red-hot\.primary`.
 */
export const tokenVar = (token: string) => {
  const [head, scale, ...steps] = token.split(".")
  if (head === "app" && steps.length > 0) {
    return `var(--chakra-colors-app-${kebab(scale)}\\.${steps.join("\\.")})`
  }
  return `var(--chakra-colors-${token.split(".").map(kebab).join("-")})`
}

/**
 * The class that points `--p-primary`, `--p-secondary` and `--p-border` at one
 * of the palette's accent trios; `card-parts.css` defines one per trio.
 */
export const paletteClass = (key: string) => `mk-pal-${kebab(key)}`

// ---------------------------------------------------------------------------
// Derived facts.
// ---------------------------------------------------------------------------

export type ViewerTone = "going" | "interested" | "invited" | "none"

export const viewerTone = (showtime: ShowtimePublic): ViewerTone => {
  const viewer = showtime.viewer
  if (viewer?.going === "GOING") return "going"
  if (viewer?.going === "INTERESTED") return "interested"
  if (viewer?.invited_by?.length) return "invited"
  return "none"
}

/** The accent trio each tone draws with. */
export const TONE_PALETTE: Record<Exclude<ViewerTone, "none">, string> = {
  going: "green",
  interested: "orange",
  invited: "blue",
}

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
 * When a screening is, in the pieces the cards print.
 *
 * Read straight off the string. Showtimes are zone-less wall-clock times
 * (`2026-09-16T20:30:00`), so the digits already are the time to show; parsing
 * them through Luxon and formatting them back with `toFormat` was measured as
 * a visible share of rendering a page of cards.
 */
export const when = (showtime: ShowtimePublic) => {
  const match = WALL_CLOCK.exec(showtime.datetime)
  const [, year, month, day, hour, minute] = match ?? [
    "",
    "1970",
    "01",
    "01",
    "00",
    "00",
  ]
  const start = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  )
  const endMatch = showtime.end_datetime
    ? WALL_CLOCK.exec(showtime.end_datetime)
    : null

  // The page's day, not the clock's: see `day-clock`. A card that prints this
  // has to subscribe with `useDayClock()`, or it will keep the label it was
  // last rendered with when the day turns over.
  const relative = relativeDayLabel(start, currentDay())
  const weekday = WEEKDAYS[start.getDay()]
  const monthName = MONTHS[start.getMonth()]
  const minutesAway = Math.round((start.getTime() - Date.now()) / 60_000)

  return {
    weekday,
    day: String(start.getDate()),
    month: monthName,
    time: `${hour}:${minute}`,
    endTime: endMatch ? `${endMatch[4]}:${endMatch[5]}` : null,
    dateShort: relative ?? `${weekday} ${start.getDate()} ${monthName}`,
    relative,
    /** "in 40 min", only for the next couple of hours. */
    soon:
      minutesAway > 0 && minutesAway <= 120
        ? minutesAway < 60
          ? `in ${minutesAway} min`
          : `in ${Math.floor(minutesAway / 60)}h ${String(minutesAway % 60).padStart(2, "0")}`
        : null,
  }
}

export const originalTitleOf = (showtime: ShowtimePublic): string | null => {
  const { title, original_title: original } = showtime.movie
  return original && original.trim() !== title.trim() ? original.trim() : null
}

export const subtitleLabels = (showtime: ShowtimePublic): string[] => {
  const subtitles = showtime.subtitles ?? []
  return [
    subtitles.includes("nl") ? "NL subs" : null,
    subtitles.includes("en") ? "EN subs" : null,
  ].filter((label): label is string => Boolean(label))
}

export const viewerSeat = (showtime: ShowtimePublic) =>
  showtime.viewer?.going === "GOING"
    ? formatSeatLabel(showtime.viewer.seat_row, showtime.viewer.seat_number)
    : null

type AudiencePerson = {
  key: string
  user: Pick<
    UserPublic,
    "id" | "display_name" | "avatar_url" | "seat_row" | "seat_number"
  >
  kind: "going" | "interested"
  /** Friends of friends and unanswered invites: reachable, not yours. */
  distant: boolean
}

export const audienceOf = (showtime: ShowtimePublic): AudiencePerson[] => {
  const viewer = showtime.viewer
  if (!viewer) return []
  return [
    ...(viewer.friends_going ?? []).map((user) => ({
      key: `g-${user.id}`,
      user,
      kind: "going" as const,
      distant: false,
    })),
    ...(viewer.friends_interested ?? []).map((user) => ({
      key: `i-${user.id}`,
      user,
      kind: "interested" as const,
      distant: false,
    })),
    ...(viewer.friends_of_friends_going ?? []).map((user) => ({
      key: `fg-${user.id}`,
      user,
      kind: "going" as const,
      distant: true,
    })),
    ...(viewer.friends_of_friends_interested ?? []).map((user) => ({
      key: `fi-${user.id}`,
      user,
      kind: "interested" as const,
      distant: true,
    })),
  ]
}

export const nameOf = (user: Pick<UserPublic, "display_name">) =>
  user.display_name?.trim() || "Friend"

// ---------------------------------------------------------------------------
// Pieces.
// ---------------------------------------------------------------------------

/** The square-cornered badge the app uses for a cinema, a room, subtitles. */
export const Tag = ({
  children,
  palette,
  size = "sm",
  trailing,
}: {
  children: string
  palette?: string
  size?: "xs" | "sm"
  /** Kept whole after the (truncating) text, like the cinema tag's festival. */
  trailing?: ReactNode
}) => (
  <span
    className={`mk-tag${size === "xs" ? " mk-tag--xs" : ""}${
      palette ? ` mk-tag--palette ${paletteClass(palette)}` : ""
    }`}
  >
    <span className="mk-ellipsis">{children}</span>
    {trailing}
  </span>
)

/**
 * The festival a screening is part of, as a tag inside its cinema's tag
 * ("Trianon | LIFF"). Not drawn when the screening is placed at the festival
 * itself (its hall is unknown): the cinema name already says it.
 */
export const FestivalMark = ({ showtime }: { showtime: ShowtimePublic }) => {
  const { festival } = showtime
  if (!festival || festival.id === showtime.cinema.id) return null
  return (
    <span
      className={`mk-tag__festival ${paletteClass(getCinemaPaletteKey(festival))}`}
      title={festival.name}
    >
      {festival.name}
    </span>
  )
}

export const CinemaTag = ({
  showtime,
  size,
}: {
  showtime: ShowtimePublic
  size?: "xs" | "sm"
}) => (
  <Tag
    palette={getCinemaPaletteKey(showtime.cinema)}
    size={size}
    trailing={<FestivalMark showtime={showtime} />}
  >
    {showtime.cinema.name}
  </Tag>
)

/**
 * The cinema tag as a way into that cinema's programme: the home feed with
 * just this cinema picked (what the cinema page used to be).
 *
 * For a card that is itself clickable, so the click stops here rather than
 * also selecting the screening. A plain anchor and `navigate` rather than the
 * router's `Link`: a wall draws hundreds of these, and `Link` subscribes each
 * one to the router's state. A real `href` keeps middle- and ⌘-click opening
 * a new tab, which is left to the browser.
 */
export const CinemaTagLink = ({
  showtime,
  size,
}: {
  showtime: ShowtimePublic
  size?: "xs" | "sm"
}) => {
  const navigate = useNavigate()
  const links = useUnfilteredLinks()
  const { cinema } = showtime
  return (
    <a
      className="mk-tag-link"
      href={`/?cinemas=${cinema.id}`}
      title={`Only ${cinema.name}`}
      onClick={(event) => {
        event.stopPropagation()
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.button !== 0
        )
          return
        event.preventDefault()
        links.onFollow()
        void navigate({
          to: "/",
          search: links.search(cinemaFeedSearch(cinema.id)) as never,
        })
      }}
      // The card answers Enter and Space as a press of its own.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <CinemaTag showtime={showtime} size={size} />
    </a>
  )
}

/**
 * Busyness in the level's own colour: teal through yellow and orange to the
 * two reds, the scale `shared/showtimes/seat-availability-level` defines.
 *
 * Only drawn once the room is actually filling up — "very busy" (the three
 * figures) and past it, `isBusySeatAvailabilityLevel`. Below that a badge on a
 * card says only "no hurry", and most screenings are there, so a wall of them
 * buried the few that matter. The panel still states every level.
 *
 * With `withCount` it says how many seats are left — of how many the room
 * holds, where that's known — rather than naming the level.
 */
export const SeatMark = ({
  showtime,
  iconOnly = false,
  withCount = false,
  overPoster = false,
}: {
  showtime: ShowtimePublic
  iconOnly?: boolean
  withCount?: boolean
  /** Outlined and lifted, so the pill holds its own on any artwork. */
  overPoster?: boolean
}) => {
  const availability = showtime.seat_availability
  const level = availability?.level
  if (!availability || !level) return null
  if (!isBusySeatAvailabilityLevel(level)) return null
  const copy = getSeatAvailabilityCopy(level)
  const look = getSeatAvailabilityPresentation(level)
  if (!copy || !look) return null
  const Icon = SEAT_LEVEL_ICON[look.icon]

  return (
    <span
      className={`mk-seat ${paletteClass(look.palette)}${iconOnly ? " mk-seat--icon" : ""}${
        overPoster ? " mk-seat--poster" : ""
      }`}
      title={formatSeatCount(availability) ?? copy.label}
    >
      <Icon className="mk-seat__icon" aria-hidden />
      {iconOnly ? null : (
        <span className="mk-ellipsis">
          {withCount
            ? (formatSeatCount(availability) ?? copy.label)
            : copy.label}
        </span>
      )}
    </span>
  )
}

/** Hides a broken `<img>` in place, rather than leaving the browser's own
 * broken-image icon — the element underneath (an initial, here) shows
 * through once it's gone. */
const hideOnError = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.display = "none"
}

/** A small circle for one row of the hover list: same photo/initial rule as
 * the stack itself, just standalone rather than overlapped. */
export const AvatarDot = ({
  user,
  kind,
  size,
}: {
  user: Pick<UserPublic, "id" | "display_name" | "avatar_url">
  kind: "going" | "interested"
  size: number
}) => (
  <span
    className={`mk-avatar ${paletteClass(getAvatarPaletteKey(user.id))} mk-avatar--${kind}`}
    style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
  >
    <span className="mk-avatar__initial">
      {getAvatarInitial(user.display_name)}
    </span>
    {user.avatar_url ? (
      <img
        className="mk-avatar__photo"
        src={user.avatar_url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={hideOnError}
      />
    ) : null}
  </span>
)

/**
 * Overlapping circles, ringed in their status colour: a photo when the person
 * has one (their linked Letterboxd account's picture), their coloured initial
 * otherwise. The initial is always in the DOM underneath — a photo that fails
 * to load (a stale Letterboxd URL, a network hiccup) hides itself via
 * `onError` and the initial shows through, so a broken image never leaves a
 * blank circle.
 *
 * Hovering (or, for a keyboard, focusing) the stack opens a list of everyone
 * in it — photo, name, a link to their own agenda — the way a name under the
 * stack would if the stack had room to print one. It opens below the stack
 * and lines up on whichever edge the stack itself sits against (`align`,
 * `HoverCard`'s `bottom-start`/`bottom-end`) — a stack pinned to a card's
 * right edge opens a list hanging off to the left of the viewport otherwise.
 * The pointer can cross the gap from the stack into the list without it
 * closing (`HoverCard`'s own hover-intent tracking, not something built by
 * hand here), and a row's own click is stopped from bubbling to the card
 * underneath, which opens the detail panel on a click of its own — visiting
 * a friend must not also select the screening.
 *
 * The list opens with the viewer's own seat first ("Your seat", spelled out
 * rather than just "Seat", so it doesn't read as one more of the seats
 * listed below it), when they have one assigned, ahead of the friends. A
 * friend who's going and has an assigned seat gets theirs printed under
 * their name the same way — `friends_going`/`friends_interested` already
 * carry `seat_row`/`seat_number` per person (only ever set for someone who's
 * actually going), this just draws it.
 */
/**
 * Anyone this list can be drawn for: the fields the rows below actually read.
 * Wider than `AudiencePerson` on purpose, so a caller whose people come from
 * somewhere other than a showtime — a film's audience, say — can use the same
 * list without inventing the fields it does not have.
 */
export type HoverCardPerson = {
  key: string
  user: Pick<UserPublic, "id" | "display_name" | "avatar_url"> & {
    seat_row?: string | null
    seat_number?: string | null
  }
  kind: "going" | "interested"
}

/**
 * The hover list itself, around whatever triggers it.
 *
 * Split out of `AvatarStack` so that a stack of faces drawn elsewhere — the
 * film cards' own, which are a film's audience or one screening's rather than
 * a `ShowtimePublic`'s — opens *this* list rather than a second one built to
 * look like it. The trigger is the caller's; everything below it is the same
 * popover on every feed.
 */
export const AudienceHoverCard = ({
  people,
  seat = null,
  align = "start",
  children,
}: {
  people: HoverCardPerson[]
  /** The viewer's own seat, printed above the friends when they have one. */
  seat?: string | null
  /** Which edge of the trigger the list lines up on. */
  align?: "start" | "end"
  children: ReactNode
}) => {
  const links = useUnfilteredLinks()
  return (
    <HoverCard.Root
      openDelay={150}
      closeDelay={150}
      positioning={{ placement: `bottom-${align}`, gutter: 10 }}
      // Off by default in this library — without them every stack on the
      // page builds and keeps its popover content mounted from the start,
      // which is exactly the per-card-up-front cost the rest of this file's
      // hover reveals are written to avoid.
      lazyMount
      unmountOnExit
    >
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>

      {/* Portalled out of the card's own `content-visibility: auto` cell,
          which clips paint to its own box regardless of how the popover
          inside it is positioned — there is no reaching past that from
          within it. */}
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content className="mk-avatars-pop" unstyled>
            {seat ? (
              <div className="mk-avatars-pop__seat">
                <span className="mk-avatars-pop__seat-label">
                  Your seat: {seat}
                </span>
                <PanelIcon.eventSeat
                  className="mk-avatars-pop__seat-icon"
                  aria-hidden
                />
              </div>
            ) : null}
            {people.map(({ key, user, kind }) => {
              const friendSeat = formatSeatLabel(
                user.seat_row,
                user.seat_number,
              )
              return (
                <Link
                  key={key}
                  to="/"
                  search={links.search(friendFeedSearch(user.id))}
                  className="mk-avatars-pop__row"
                  // The card underneath opens the panel on its own click; going
                  // to a friend's agenda must not also select the screening.
                  // (React bubbles a portalled element's events through the
                  // component tree it was rendered from, not the DOM tree it
                  // was moved to, so this still reaches the card without it.)
                  onClick={(event) => {
                    event.stopPropagation()
                    links.onFollow()
                  }}
                >
                  <span className="mk-avatars-pop__info">
                    <span className="mk-avatars-pop__name">{nameOf(user)}</span>
                    {friendSeat ? (
                      <span className="mk-avatars-pop__row-seat">
                        Seat {friendSeat}
                      </span>
                    ) : null}
                  </span>
                  <AvatarDot user={user} kind={kind} size={26} />
                </Link>
              )
            })}
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  )
}

export const AvatarStack = ({
  showtime,
  max = 5,
  size = 22,
  ringColor = "bg.panel",
  align = "start",
  unit,
}: {
  showtime: ShowtimePublic
  max?: number
  size?: number
  /**
   * A CSS length `size` counts in, instead of pixels — the ticket wall's
   * `var(--mk-u)`, so its avatars grow with the ticket.
   */
  unit?: string
  /** The token the card is filled with, so each circle is cut out of it. */
  ringColor?: string
  /** Which edge of the stack the hover list lines up on. */
  align?: "start" | "end"
}) => {
  const people = audienceOf(showtime).filter((person) => !person.distant)
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  const overflow = people.length - shown.length
  const length = (pixels: number) =>
    unit ? `calc(${pixels} * ${unit})` : pixels

  return (
    <AudienceHoverCard
      people={people}
      seat={viewerSeat(showtime)}
      align={align}
    >
      <span
        className="mk-avatars"
        style={{ "--mk-ring": tokenVar(ringColor) } as CSSProperties}
        aria-label={`Friends: ${people.map((person) => nameOf(person.user)).join(", ")}`}
      >
        {shown.map(({ key, user, kind }, index) => (
          <span
            key={key}
            className={`mk-avatar ${paletteClass(getAvatarPaletteKey(user.id))} mk-avatar--${kind}`}
            style={{
              width: length(size),
              height: length(size),
              fontSize: length(Math.round(size * 0.45)),
              marginLeft: index === 0 ? 0 : length(-Math.round(size * 0.12)),
              zIndex: shown.length - index,
            }}
          >
            {getAvatarInitial(user.display_name)}
            {user.avatar_url ? (
              <img
                className="mk-avatar__photo"
                src={user.avatar_url}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={hideOnError}
              />
            ) : null}
          </span>
        ))}
        {overflow > 0 ? (
          <span className="mk-avatars__more">+{overflow}</span>
        ) : null}
      </span>
    </AudienceHoverCard>
  )
}

export const InvitedLine = ({ showtime }: { showtime: ShowtimePublic }) => {
  const invitedBy = showtime.viewer?.invited_by ?? []
  if (!invitedBy.length || showtime.viewer?.going !== "NOT_GOING") return null
  return (
    <span className="mk-invited">
      <PanelIcon.mailOutline className="mk-invited__icon" aria-hidden />
      <span className="mk-invited__text">
        {invitedBy.length === 1
          ? `${nameOf(invitedBy[0])} invited you`
          : `${nameOf(invitedBy[0])} +${invitedBy.length - 1} invited you`}
      </span>
    </span>
  )
}

/**
 * What a synthetic listing (a sneak preview, whose film is secret until it
 * starts) shows in place of a poster: a big "?" on a gradient, as the app's
 * `PosterPlaceholder` does. Fills whatever poster box it is dropped into, and
 * sizes the glyph to that box's width.
 */
export const UnknownPoster = () => (
  <span className="mk-poster__unknown" aria-hidden>
    <span className="mk-poster__unknown-glyph">?</span>
  </span>
)

/**
 * A poster that is a coloured block while it loads or when there is none.
 *
 * A lazily loaded, asynchronously decoded image rather than a CSS background:
 * a feed scrolled a few pages deep holds hundreds of posters, and a background
 * image is fetched the moment its element exists and decoded on the main
 * thread when it first paints.
 */
export const Poster = ({
  showtime,
  width,
  height,
  radius = "4px",
  children,
}: {
  showtime: ShowtimePublic
  width: string
  height?: string
  radius?: string
  children?: ReactNode
}) => (
  <span
    className={`mk-poster${height ? "" : " mk-poster--ratio"}`}
    style={{ width, height, borderRadius: radius }}
  >
    {isSyntheticMovieId(showtime.movie.id) ? (
      <UnknownPoster />
    ) : showtime.movie.poster_link ? (
      <img
        src={showtime.movie.poster_link}
        // Sharper TMDB sizes for a big card or a dense screen.
        srcSet={posterSrcSet(showtime.movie.poster_link)}
        sizes={posterSizes(width)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    ) : null}
    {children}
  </span>
)
