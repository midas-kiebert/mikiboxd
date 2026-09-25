/**
 * One screening on the Activity page, as a line of an agenda rather than a
 * ticket.
 *
 * The ticket wall is built to be browsed: every card has to catch the eye in a
 * long wall of alternatives, so the poster is the card. Activity is read top
 * to bottom — a list of plans to go through — so here the *time* leads and the
 * poster is a thumbnail. Friends get a face stack per status, going and
 * interested on their own lines; hovering one names them.
 *
 * Your own status is colour only — a bar down the row's edge, green going,
 * orange interested, blue invited — not a word: in a list of your own plans a "GOING" on most rows
 * was noise, and the colour is what the eye runs down. An invite also fills
 * the row in blue: it is waiting on you, so it should catch the eye.
 *
 * Laid out in columns across the width — when, film, where, who — so that a
 * wide screen reads as a table you can run your eye down, one fact per column,
 * rather than as the same stack of lines a phone gets with margins either
 * side. As the list narrows (the showtime panel docks beside it, or a smaller
 * window) the columns fold under the film, in `activity.css`, against the
 * list's own width.
 *
 * Plain elements and one stylesheet, like the card pieces it borrows; see the
 * note in `card-parts.tsx` for why.
 */
import type { KeyboardEvent } from "react"
import type { ShowtimePublic, UserPublic } from "shared"

import { metaOf } from "@/components/Movies/cards/film-card-kit"
import {
  AudienceHoverCard,
  AvatarDot,
  CinemaTagLink,
  type HoverCardPerson,
  InvitedLine,
  Poster,
  SeatMark,
  TONE_PALETTE,
  Tag,
  nameOf,
  originalTitleOf,
  paletteClass,
  subtitleLabels,
  viewerSeat,
  viewerTone,
  when,
} from "@/components/Showtimes/cards/card-parts"
import { useDayClock } from "@/features/showtimes/day-clock"

import "./activity.css"

const KIND_WORD = {
  going: "going",
  interested: "interested",
} as const

/** Faces drawn on a line before the rest are counted. */
const MAX_FACES = 4
const FACE_SIZE = 24
const FACE_OVERLAP = 5

type ActivityRowProps = {
  showtime: ShowtimePublic
  isSelected: boolean
  /** Stable across renders, so memoised rows stay put. */
  onSelect: (showtime: ShowtimePublic) => void
}

/**
 * One kind of friend on a screening: their faces, ringed in the status's own
 * colour. Hovering them opens the same list the ticket wall's stack does, with
 * a link to each one's agenda.
 */
const PeopleLine = ({
  people,
  kind,
}: {
  people: UserPublic[]
  kind: "going" | "interested"
}) => {
  if (people.length === 0) return null
  const shown = people.slice(0, MAX_FACES)
  const overflow = people.length - shown.length
  const hoverPeople: HoverCardPerson[] = people.map((user) => ({
    key: `${kind}-${user.id}`,
    user,
    kind,
  }))

  return (
    <div className={`ac-people ac-people--${kind}`}>
      <AudienceHoverCard people={hoverPeople}>
        <span
          className="mk-avatars ac-people__faces"
          aria-label={`${people.map(nameOf).join(", ")} ${KIND_WORD[kind]}`}
        >
          {shown.map((user, index) => (
            <span
              key={user.id}
              className="ac-people__face"
              style={{
                marginLeft: index === 0 ? 0 : -FACE_OVERLAP,
                zIndex: shown.length - index,
              }}
            >
              <AvatarDot user={user} kind={kind} size={FACE_SIZE} />
            </span>
          ))}
          {overflow > 0 ? (
            <span className="mk-avatars__more">+{overflow}</span>
          ) : null}
        </span>
      </AudienceHoverCard>
    </div>
  )
}

const ActivityRow = ({ showtime, isSelected, onSelect }: ActivityRowProps) => {
  // Subscribed to, not read: memoised, so without a hold on the page's day it
  // would keep a stale "in 40 min" and day label. See `day-clock`.
  useDayClock()
  const time = when(showtime)
  const tone = viewerTone(showtime)
  const palette = tone === "none" ? null : TONE_PALETTE[tone]
  const originalTitle = originalTitleOf(showtime)
  const meta = metaOf(showtime.movie)
  const seat = viewerSeat(showtime)
  const viewer = showtime.viewer
  const friendsGoing = viewer?.friends_going ?? []
  const friendsInterested = viewer?.friends_interested ?? []
  const hasFriends = friendsGoing.length + friendsInterested.length > 0

  const handleKeyDown = (event: KeyboardEvent) => {
    // Only keys aimed at the row itself, not at a link or face inside it.
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onSelect(showtime)
    }
  }

  return (
    <div
      className={`ac-row${palette ? ` ac-row--toned ac-row--${tone} ${paletteClass(palette)}` : ""}`}
      // biome-ignore lint/a11y/useSemanticElements: a row of block content, which a <button> may not hold
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onSelect(showtime)}
      onKeyDown={handleKeyDown}
    >
      <div className="ac-row__time">
        <span className="ac-row__clock">{time.time}</span>
        {time.endTime ? (
          <span className="ac-row__end">until {time.endTime}</span>
        ) : null}
        {time.soon ? <span className="ac-row__soon">{time.soon}</span> : null}
      </div>

      <div className="ac-row__poster">
        <Poster showtime={showtime} width="100%" radius="5px" />
      </div>

      <div className="ac-row__film">
        <div className="ac-row__title">{showtime.movie.title}</div>
        {originalTitle ? (
          <div className="ac-row__original">{originalTitle}</div>
        ) : null}
        {meta.length ? (
          <div className="ac-row__meta">{meta.join(" · ")}</div>
        ) : null}
      </div>

      <div className="ac-row__where">
        <CinemaTagLink showtime={showtime} size="sm" />
        <div className="ac-row__tags">
          {showtime.room ? <Tag size="xs">{showtime.room}</Tag> : null}
          {subtitleLabels(showtime).map((label) => (
            <Tag key={label} size="xs">
              {label}
            </Tag>
          ))}
          {seat ? <span className="ac-row__seat">Seat {seat}</span> : null}
          <SeatMark showtime={showtime} withCount />
        </div>
      </div>

      <div className="ac-row__who">
        <InvitedLine showtime={showtime} />
        <PeopleLine people={friendsGoing} kind="going" />
        <PeopleLine people={friendsInterested} kind="interested" />
        {/* Your own plan with nobody else on it yet: said, rather than an
            empty column that reads as missing data. */}
        {hasFriends || tone === "none" || tone === "invited" ? null : (
          <span className="ac-row__nobody">No friends on this yet</span>
        )}
      </div>
    </div>
  )
}

export default ActivityRow
