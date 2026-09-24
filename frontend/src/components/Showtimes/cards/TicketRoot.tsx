/**
 * The pressable root every ticket-shaped showtime card sits in: keyboard
 * activation, and the resting and hover shadows.
 *
 * The shape itself — the rounded frame with semicircles punched out of its
 * edges, cut like the MiKiNO mark — is passed in as `shape`, painted under
 * the content; the ticket wall's card draws its own from static CSS
 * (`PortraitTicketCard.css`). The content sits on top in normal flow and sets
 * the height, so a ticket is as tall as whatever is inside it.
 *
 * The shadow is a `box-shadow` on an empty layer underneath, not a
 * `filter: drop-shadow` on the ticket. A drop-shadow would follow the notches,
 * but it renders every ticket through its own offscreen surface and blurs it
 * again on each repaint — measured, it was most of the raster work when a wall
 * of tickets was hovered or selected. A box-shadow draws only *outside* the
 * layer's box, so the notches stay clean anyway; the difference is a hairline
 * of shadow across each notch's mouth.
 *
 * Shadows read `--mk-shadow`, `--mk-lift` and `--mk-radius`, which
 * `card-parts.css` defaults and a shape may override.
 *
 * Plain elements and classes from `card-parts.css`, like the rest of the
 * card pieces; see the note in `card-parts.tsx` for why.
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from "react"

type TicketRootProps = {
  children: ReactNode
  /** Painted under the content: the ticket's own border and fill layers. */
  shape: ReactNode
  className?: string
  style?: CSSProperties
  isSelected?: boolean
  onClick?: () => void
}

export const TicketRoot = ({
  children,
  shape,
  className,
  style,
  isSelected = false,
  onClick,
}: TicketRootProps) => {
  const handleKeyDown = (event: KeyboardEvent) => {
    // Only keys aimed at the card itself, not at anything focusable inside it.
    if (!onClick || event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <div
      className={`mk-ticket${className ? ` ${className}` : ""}`}
      style={style}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? isSelected : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="mk-ticket__shadow" aria-hidden />
      {onClick ? <div className="mk-ticket__lift" aria-hidden /> : null}
      {shape}
      <div className="mk-ticket__content">{children}</div>
    </div>
  )
}

export default TicketRoot
