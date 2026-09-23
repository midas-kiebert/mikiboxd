import { useDayClock } from "@/features/showtimes/day-clock"
import { TicketRoot } from "./TicketRoot"
/**
 * Card variant: the feed as a wall of tickets. Upright, poster on top, a tear
 * line with side notches, and the screening on the stub below. Meant for a
 * grid rather than a list, so the feed lays these out several to a row.
 *
 * The card takes its width from the grid column, so the poster — and the tear
 * under it — scale with it. The notches and the tear are one element pinned to
 * the top of the stub (see `PortraitTicketCard.css`), so they sit on the seam
 * wherever the poster's height puts it, without the card having to know its
 * own width. Every row of the stub has a fixed height, so all tickets in a
 * row of the grid are the same height whatever they carry: no invite, no
 * seat, no friends each leave their row empty rather than shortening the
 * card. The seat/invite line shares its row with the friends avatars — left
 * and right of the same line — rather than getting a row of its own, since
 * it's rarer than either (only a `GOING` ticket with an assigned seat, or an
 * unanswered invite) and a whole row reserved just for it was mostly empty
 * space on top of the friends row's own. The cinema/subtitle row is last,
 * after that combined row rather than right under the date — it's the one
 * row every ticket always has something in, so whatever empty space a
 * shorter ticket carries sits in the middle rather than right above the
 * bottom edge, which read as a stray gap rather than a row.
 *
 * Plain elements and static CSS, like the pieces it is made of; see the note
 * in `card-parts.tsx` for why.
 */
import {
  AvatarStack,
  CinemaTagLink,
  InvitedLine,
  Poster,
  SeatMark,
  type ShowtimeCardProps,
  TONE_PALETTE,
  Tag,
  originalTitleOf,
  paletteClass,
  subtitleLabels,
  viewerSeat,
  viewerTone,
  when,
} from "./card-parts"

import "./PortraitTicketCard.css"

/**
 * The narrowest a ticket gets before the grid drops a column. Sized so the
 * stub's widest line — the time beside a "Tue 16 Sep" date — still fits.
 */
export const PORTRAIT_MIN_COLUMN_WIDTH = 168

/** The card's face and outline, under everything else. */
const FRAME = <div className="mk-wall__frame" aria-hidden />

const PortraitTicketCard = ({
  showtime,
  isSelected,
  onSelect,
}: ShowtimeCardProps) => {
  const tone = viewerTone(showtime)
  const palette = tone === "none" ? null : TONE_PALETTE[tone]
  // Subscribed to, not read: this card is memoised, so without a hold on the
  // page's day it would keep the label it was last rendered with when the day
  // turns over — and the wall would relabel itself one card at a time.
  useDayClock()
  const time = when(showtime)
  const originalTitle = originalTitleOf(showtime)
  const seat = viewerSeat(showtime)

  const className = [
    "mk-wall mk-wall--portrait",
    palette ? `mk-wall--toned ${paletteClass(palette)}` : "",
    tone === "going" || tone === "interested" ? "mk-wall--glow" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <TicketRoot
      className={className}
      shape={FRAME}
      isSelected={isSelected}
      onClick={() => onSelect(showtime)}
    >
      <div className="mk-wall__top">
        <Poster showtime={showtime} width="100%" radius="7px" />
        <div className="mk-wall__shade">
          <div className="mk-wall__title">{showtime.movie.title}</div>
          {originalTitle ? (
            <div className="mk-wall__original">{originalTitle}</div>
          ) : null}
        </div>
        <div className="mk-wall__seats">
          <SeatMark showtime={showtime} withCount overPoster />
        </div>
      </div>

      <div className="mk-wall__stub">
        <div className="mk-wall__seam" aria-hidden />

        <div className="mk-wall__row mk-wall__when">
          <span className="mk-wall__date">{time.dateShort}</span>
          <span className="mk-wall__time">{time.time}</span>
        </div>

        <div className="mk-wall__row mk-wall__friends">
          <span className="mk-wall__note">
            {seat ? (
              <span className="mk-wall__your-seat">SEAT {seat}</span>
            ) : (
              <InvitedLine showtime={showtime} />
            )}
          </span>
          <AvatarStack
            showtime={showtime}
            size={28}
            unit="var(--mk-u)"
            max={5}
            ringColor={palette ? `app.${palette}.primary` : "bg.panel"}
            align="end"
          />
        </div>

        <div className="mk-wall__row mk-wall__tags">
          <span className="mk-wall__venue">
            <CinemaTagLink showtime={showtime} size="xs" />
          </span>
          {subtitleLabels(showtime).map((label) => (
            <Tag key={label} size="xs">
              {label}
            </Tag>
          ))}
        </div>
      </div>
    </TicketRoot>
  )
}

export default PortraitTicketCard
