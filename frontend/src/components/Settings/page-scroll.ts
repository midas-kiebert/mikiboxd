/**
 * Scrolling the Settings page to one of its parts.
 *
 * Not `scrollIntoView`: that scrolls every ancestor it can, and the layout's
 * outer grid is `overflow: hidden` — scrollable by script, just not by the
 * user — so it slid the whole layout up and took the top nav off the screen
 * with no way to bring it back. This moves only the box the page scrolls in.
 */

/** Room left above a section when it is scrolled to. */
const TOP_GAP_PX = 24
/** Room left below a part scrolled up from the bottom. */
const BOTTOM_GAP_PX = 32

/** The element the page scrolls in: the layout's content box, not the window. */
export const findScrollParent = (
  element: HTMLElement | null | undefined,
): HTMLElement | null => {
  let current = element?.parentElement ?? null
  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === "auto" || overflowY === "scroll") return current
    current = current.parentElement
  }
  return null
}

/**
 * `start` puts the element's top near the top of the page's box; `end`
 * scrolls only as far as it takes for the element's bottom to show.
 */
export const scrollPageTo = (
  element: HTMLElement | null,
  {
    align = "start",
    smooth = true,
  }: { align?: "start" | "end"; smooth?: boolean } = {},
) => {
  const scroller = findScrollParent(element)
  if (!element || !scroller) return
  const box = scroller.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  let delta = rect.top - box.top - TOP_GAP_PX
  if (align === "end") {
    delta = rect.bottom - box.bottom + BOTTOM_GAP_PX
    if (delta <= 0) return
  }
  scroller.scrollTo({
    top: scroller.scrollTop + delta,
    behavior: smooth ? "smooth" : "auto",
  })
}
