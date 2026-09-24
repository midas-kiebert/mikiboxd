/**
 * The open/close state machine for a docked detail column: the feeds' showtime
 * panel (`FeedLayout`) and the film page's (`MoviePage`) both run on it, so a
 * screening opens and shuts the same way wherever it is pressed.
 *
 * The thing that makes this harder than a CSS class toggle is that rendering
 * the panel is *expensive* — measured at 43-110ms of blocked main thread, it
 * being a poster, five sections and a handful of queries. A CSS transition
 * keeps its own clock while the main thread is blocked, so flipping the width
 * in the same commit that renders the panel loses however long that render
 * takes: nothing paints, the clock runs on, and the first frame the eye
 * actually gets is already a third of the way through. Measured reopening
 * mid-close, the column sat still at 112px for 62ms and then appeared at
 * 213px — a jump of 101px in one frame, which is the lurch that reads as the
 * panel snapping open. The band it happened in is exactly the one that gets
 * reported: too late for the close to still be near full width, too early for
 * it to have finished and unmounted.
 *
 * So the column is never asked to animate out of a commit that renders the
 * panel. `arming` is that commit: the panel renders, and the column is held
 * at an exact size with its transition off, so the expensive frame cannot
 * consume any of the animation. Two frames later — one is not enough, an
 * effect runs after a commit but before it has necessarily painted — the pin
 * comes off and the column travels.
 *
 * `paintedColumn` is what a mid-close reopen pins to. It has to be the last
 * size the column was *painted* at rather than what it measures at the moment
 * of the click, because those differ by exactly the blocked render: the
 * transition would have carried on shrinking behind it. Sampling every frame
 * while closing gives the painted value for free — a blocked main thread runs
 * no frames, so the last sample is the last thing drawn.
 *
 * The caller keeps the content the close animates out (by then it has already
 * stopped having a panel to pass), and renders the column while `isMounted`,
 * with `columnStyle` on the column and `cardStyle` on the card inside it.
 */
import { useEffect, useRef, useState } from "react"

/**
 * How long the column takes to open or close, and how long the card inside it
 * takes to fade.
 *
 * Two clocks rather than one, because the column and the card are doing
 * different jobs. The column's width is a *layout* change — what sits beside
 * it genuinely gets narrower — and that wants to be unhurried enough to read
 * as the page making room. The card is just arriving, and it must be gone
 * before the column has finished closing around it: a card that fades on the
 * same clock as the width appears to be crushed rather than dismissed. So
 * closing fades first and narrows after, and opening widens first and fades in
 * last.
 */
export const DETAIL_WIDTH_MS = 220
export const DETAIL_FADE_MS = 140

/**
 * A column held at an exact size with its transition switched off, which is how
 * both the cold open and the mid-close reopen get a start value to animate from.
 * `gap` travels with `width` because the leading margin is on the same clock:
 * pinning one without the other moves the column by the gap in a single frame.
 */
export type PinnedColumn = { width: number; gap: number }

/** A column that is not on screen: both the start of an open and the end of a close. */
const CLOSED_COLUMN: PinnedColumn = { width: 0, gap: 0 }

const measureColumn = (element: HTMLElement | null): PinnedColumn =>
  element
    ? {
        width: element.getBoundingClientRect().width,
        gap:
          Number.parseFloat(getComputedStyle(element).marginInlineStart) || 0,
      }
    : CLOSED_COLUMN

/** `arming` is the commit that renders the panel, with the column pinned. */
type DetailPhase = "closed" | "arming" | "open" | "closing"

/**
 * The column's width, leading gap and transition for where the machine is.
 * The gap is the column's own margin rather than the row's `gap`, because a
 * zero-width flex item still gets a gap — a closed panel left a 24px hole that
 * snapped away at the end of the animation. The column clips horizontally so
 * the card keeps its own width while the column shuts around it.
 */
export const detailColumnStyle = <W>(
  width: W,
  leadingGap: number,
  { isOpen, pinned }: { isOpen: boolean; pinned: PinnedColumn | null },
) => ({
  w: pinned ? `${pinned.width}px` : isOpen ? width : "0px",
  ms: pinned ? `${pinned.gap}px` : isOpen ? `${leadingGap}px` : "0px",
  transition: pinned
    ? "none"
    : `width ${DETAIL_WIDTH_MS}ms ease, margin-inline-start ${DETAIL_WIDTH_MS}ms ease`,
  overflowX: "hidden" as const,
})

/**
 * The card inside the column. Full width of the column's content box while
 * open, so a panel long enough to scroll does not have its own scrollbar cut a
 * strip off its right edge; held at the column's full width only while it
 * shuts, so it leaves at full size rather than being squeezed into nothing.
 * Opening: the column widens, and the card arrives into the space that is
 * already there. Closing: the card goes first, so the width finishes on an
 * empty column.
 */
export const detailCardStyle = <W>(width: W, isOpen: boolean) => ({
  w: isOpen ? "100%" : width,
  opacity: isOpen ? 1 : 0,
  transition: isOpen
    ? `opacity ${DETAIL_FADE_MS}ms ease ${DETAIL_WIDTH_MS - DETAIL_FADE_MS}ms`
    : `opacity ${DETAIL_FADE_MS}ms ease`,
})

/**
 * `hasDetail` is whether a panel should be showing. The column starts open when
 * it already is on the first render, so a page that loads with a screening
 * selected does not animate it in.
 */
export const useDetailColumn = (hasDetail: boolean) => {
  const [phase, setPhase] = useState<DetailPhase>(hasDetail ? "open" : "closed")
  const [pinned, setPinned] = useState<PinnedColumn | null>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const paintedColumn = useRef<PinnedColumn>(CLOSED_COLUMN)
  // The phase as the *previous* commit left it, for the effect below, which
  // reacts to `hasDetail` alone: taking the phase as a dependency would re-run
  // it — and cancel the frames an arming column is waiting on — every time it
  // moved the phase on itself.
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // The unmount is scheduled here, alongside the click that causes it, rather
  // than from an effect keyed on the phase. A phase-keyed effect only clears
  // the timer in the *commit* that leaves `closing`, and a reopen arriving in
  // the last twenty milliseconds of the close does not get that far in time:
  // the render is slow enough that the timer comes due while it runs, so it
  // fires in the gap between this effect and that commit and takes the panel
  // to `closed` after it had already been armed to reopen. Reopening at a
  // 200-220ms gap left the panel shut for good. Clearing it in this effect's
  // own cleanup is synchronous with the click and cannot lose that race.
  useEffect(() => {
    if (hasDetail) {
      // Already open (the first render, or a switch between two screenings):
      // nothing to animate.
      if (phaseRef.current === "open") return
      // From `closed` there is nothing on screen to pin to and the column
      // starts from nothing; from `closing` it picks up where it was drawn.
      setPinned(
        phaseRef.current === "closed" ? CLOSED_COLUMN : paintedColumn.current,
      )
      setPhase("arming")
      return
    }
    if (phaseRef.current === "closed") return
    // Read before the phase changes: this still measures the open column.
    paintedColumn.current = measureColumn(columnRef.current)
    setPinned(null)
    setPhase("closing")
    // Unmounted once it is shut, so a closed panel's queries — the seat
    // availability poll, most of all — do not keep running behind the page.
    const timer = setTimeout(() => setPhase("closed"), DETAIL_WIDTH_MS)
    return () => clearTimeout(timer)
  }, [hasDetail])

  useEffect(() => {
    if (phase !== "arming") return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setPinned(null)
        setPhase("open")
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== "closing") return
    let frame = requestAnimationFrame(function sample() {
      paintedColumn.current = measureColumn(columnRef.current)
      frame = requestAnimationFrame(sample)
    })
    return () => cancelAnimationFrame(frame)
  }, [phase])

  return {
    /** Render the column at all: open, opening, or still closing. */
    isMounted: phase !== "closed",
    /** Open or opening: the column's target is its full width. */
    isOpen: phase === "open",
    pinned,
    columnRef,
  }
}
