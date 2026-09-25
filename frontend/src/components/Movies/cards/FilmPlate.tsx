/**
 * One screening of a film, pressable: the venue over the day over the times,
 * with the friends who picked it standing on its bottom edge and a mark in the
 * corner when the room is filling up.
 *
 * It is the row's unit of action and the only thing on the row that opens the
 * panel. Everything on it is there because it changes which screening you
 * press: the venue (where), the day written out (when), the start (whether
 * you can make it), the friends (who), the seats (whether you still can).
 * Nothing else fits, and nothing else earns the width.
 */
import type { MouseEvent } from "react"
import { getCinemaPaletteKey } from "shared/cinemas/cinema-color"
import {
  getSeatAvailabilityPresentation,
  isBusySeatAvailabilityLevel,
} from "shared/showtimes/seat-availability-level"
import {
  getAvatarInitial,
  getAvatarPaletteKey,
} from "shared/users/avatar-color"

import {
  AudienceHoverCard,
  paletteClass,
} from "@/components/Showtimes/cards/card-parts"
import { SEAT_LEVEL_ICON } from "@/components/Showtimes/detail/panel-icons"

import {
  type FilmPerson,
  type FilmTime,
  audienceOfTime,
  hideOnError,
} from "./film-card-kit"

import type { ShowtimeInMoviePublic } from "shared"

/**
 * How many circles — faces, plus the "+N" tally when there are more friends
 * than that — a plate's bottom edge holds.
 *
 * Measured against the narrowest plate any grid draws (96px): circles are
 * 15px, flush, from 4px in, with 3.5px of ring outside each box, so five end
 * at 82.5px. The seat mark in the opposite corner starts at 81px, so a plate
 * carrying one gets four. It was two and a tally, which left most of every
 * plate's edge empty ("allow some more user avatars to show up,
 * there is plenty of space").
 */
const MAX_CIRCLES = 5
const MAX_CIRCLES_BESIDE_SEAT_MARK = 4

const hasSeatMark = (showtime: ShowtimeInMoviePublic) => {
  const level = showtime.seat_availability?.level
  return Boolean(level && isBusySeatAvailabilityLevel(level))
}

/**
 * How full the screening is, when that is worth saying: a single glyph, in the
 * level's own colour, in the plate's bottom-right corner.
 *
 * `isBusySeatAvailabilityLevel` is the rule the showtime wall's `SeatMark`
 * uses — only the three levels that cost you a ticket ("very busy", "last
 * few", "sold out"), because "some seats taken" is the normal state of a
 * screening and a mark on every plate is not a mark at all.
 *
 * It sat inside the venue band first, where it ate the name's width and put a
 * second colour in a band whose whole job is to be the cinema's.
 */
const PlateBusy = ({ showtime }: { showtime: ShowtimeInMoviePublic }) => {
  const level = showtime.seat_availability?.level
  if (!level || !isBusySeatAvailabilityLevel(level)) return null
  const look = getSeatAvailabilityPresentation(level)
  if (!look) return null
  const Icon = SEAT_LEVEL_ICON[look.icon]
  // The palette class lands on the glyph itself, so `--p-*` there is the
  // level's trio while the plate around it keeps the cinema's.
  return (
    <Icon
      className={`fc-plate__busy ${paletteClass(look.palette)}`}
      aria-hidden
    />
  )
}

/**
 * The friends on one screening, standing on the bottom edge of its plate.
 *
 * Mostly on the plate rather than mostly off it: they belong to it. Hovering
 * opens the showtime wall's own list of who they are, for the same reason a
 * card's stack does — at thirteen pixels a face is a marker, and the names
 * have to live somewhere. The stack stays out of the accessibility tree: it
 * sits inside the plate's own button, whose name would otherwise collect a
 * row of initials.
 */
const PlateFaces = ({
  people,
  maxCircles,
  size = 15,
}: {
  people: FilmPerson[]
  maxCircles: number
  size?: number
}) => {
  if (people.length === 0) return null
  // Everyone, when everyone fits: a "+1" takes the room of the face it hides.
  const shown =
    people.length <= maxCircles ? people : people.slice(0, maxCircles - 1)
  const overflow = people.length - shown.length

  return (
    <AudienceHoverCard people={people}>
      <span className="fc-plate__faces" aria-hidden>
        {shown.map(({ key, user, kind }, index) => (
          <span
            key={key}
            className={`mk-avatar ${paletteClass(getAvatarPaletteKey(user.id))} mk-avatar--${kind}`}
            style={{
              width: size,
              height: size,
              fontSize: Math.round(size * 0.5),
              // Flush, not overlapped: each circle carries 3.5px of ring
              // outside its box, so two faces whose boxes merely touch already
              // overlap by seven pixels.
              marginLeft: 0,
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
          <span
            // The palette's grey, so the circle is a face without a person
            // rather than a grey disc on a grey plate.
            className="fc-face-more mk-pal-gray"
            style={{
              width: size,
              height: size,
              fontSize: Math.round(size * 0.46),
              zIndex: 0,
            }}
          >
            +{overflow}
          </span>
        ) : null}
      </span>
    </AudienceHoverCard>
  )
}

/**
 * The festival shown on a plate's label, if any. None where the screening is
 * placed at the festival itself (its hall unknown): the name already says it.
 */
const labelFestival = (time: FilmTime) => {
  const { festival } = time.showtime
  return festival && festival.id !== time.cinema.id ? festival : null
}

/**
 * How many characters of label a one-column plate holds before its name is
 * cut. Counted rather than measured: a row lays its plates out once, from the
 * data, and measuring would mean rendering every plate twice.
 */
// "Filmhuis Den Haag" (17) is the longest name that has to fit, and does.
const ONE_COLUMN_LABEL_CHARS = 18

/** Label width per character, in row pixels: 9.5px bold, erring wide. */
const LABEL_CHAR_WIDTH = 6.2
/** The label's own side padding plus the festival tag's, in row pixels. */
const LABEL_PADDING = 8
const FESTIVAL_TAG_PADDING = 9

/**
 * How wide a plate in a film row will lay out, for fitting a line of them:
 * the standard width, or — where the label (the cinema, plus the festival
 * tag) needs more, "Filmhuis Den Haag LIFF" — just that. The plate itself is
 * sized by its content (`film-cards.css`); this is the row's estimate of it,
 * on the wide side so a line never overflows.
 */
export const plateWidth = (time: FilmTime, standardWidth: number): number => {
  const festival = labelFestival(time)
  const chars = time.cinema.name.length + (festival ? festival.name.length : 0)
  if (chars <= ONE_COLUMN_LABEL_CHARS) return standardWidth
  const unit = standardWidth / 96
  const label =
    chars * LABEL_CHAR_WIDTH +
    LABEL_PADDING +
    (festival ? FESTIVAL_TAG_PADDING : 0)
  return Math.max(standardWidth, Math.ceil(label * unit))
}

export const Plate = ({
  time,
  isSelected,
  onSelect,
  showDate = true,
}: {
  time: FilmTime
  isSelected: boolean
  onSelect?: (time: FilmTime) => void
  /**
   * False where something above the plate already says which day it is — the
   * film page groups its run under day headings, and a plate repeating
   * "Sat 27 Sep" under a heading that says the same is a line spent twice.
   */
  showDate?: boolean
}) => {
  const people = audienceOfTime(time.showtime)
  const festival = labelFestival(time)
  const mine = time.showtime.viewer?.going
  const tone =
    mine === "GOING"
      ? " fc-plate--going"
      : mine === "INTERESTED"
        ? " fc-plate--interested"
        : ""

  return (
    <button
      type="button"
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
        onSelect?.(time)
      }}
      className={`fc-plate ${paletteClass(getCinemaPaletteKey(time.cinema))}${tone}${
        isSelected ? " fc-plate--on" : ""
      }`}
    >
      <span className="fc-plate__label">
        <span className="fc-plate__label-name">{time.cinema.name}</span>
        {festival ? (
          <span className="fc-plate__label-festival">{festival.name}</span>
        ) : null}
      </span>
      {showDate ? (
        <span className="fc-plate__date">{time.datePlate}</span>
      ) : null}
      <span className="fc-plate__time">{time.time}</span>
      <PlateBusy showtime={time.showtime} />
      <PlateFaces
        people={people}
        maxCircles={
          hasSeatMark(time.showtime)
            ? MAX_CIRCLES_BESIDE_SEAT_MARK
            : MAX_CIRCLES
        }
      />
    </button>
  )
}

export default Plate
