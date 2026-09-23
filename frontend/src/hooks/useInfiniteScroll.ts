/**
 * Custom web hook for Use Infinite Scroll. It encapsulates reusable stateful behavior.
 *
 * The sentinel decides its own observer root: feeds that scroll inside a column
 * of their own are clipped by that column long before they reach the viewport,
 * so observing the viewport would only ever fire once the sentinel was already
 * on screen and `rootMargin` would buy nothing.
 */
import { useEffect, useRef } from "react"

interface InfiniteScrollProps {
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  /**
   * How far past the sentinel to start looking for it. A percentage is read
   * against the scrolling root's own height, which is how a caller asks for a
   * runway in screenfuls rather than in pixels that mean a different amount of
   * feed on every screen.
   */
  rootMargin?: string
}

/** The nearest ancestor that actually scrolls, or null for the viewport. */
const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let node = el?.parentElement ?? null
  while (node) {
    const { overflowY } = window.getComputedStyle(node)
    if (overflowY === "auto" || overflowY === "scroll") return node
    node = node.parentElement
  }
  return null
}

const useInfiniteScroll = ({
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  loadMoreRef,
  rootMargin = "200px",
}: InfiniteScrollProps) => {
  // Read at call time, so a new function identity does not rebuild the observer.
  const fetchNext = useRef(fetchNextPage)
  fetchNext.current = fetchNextPage

  // Only rebuilt when whether to load can actually change. This used to run
  // after *every* render of the page — and `findScrollParent` reads computed
  // styles up the tree, which forces a style recalculation — so clicking a
  // showtime paid for a recalc before the click could paint. An observer
  // reports the sentinel's current state as soon as it starts observing, so
  // re-creating it when a page finishes loading is also what asks for the
  // next page if the sentinel is still in reach.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return

    const el = loadMoreRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchNext.current()
      },
      { root: findScrollParent(el), rootMargin },
    )
    observer.observe(el)

    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, loadMoreRef, rootMargin])
}

export default useInfiniteScroll
