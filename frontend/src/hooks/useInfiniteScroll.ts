/**
 * Custom web hook for Use Infinite Scroll. It encapsulates reusable stateful behavior.
 *
 * The sentinel decides its own observer root: feeds that scroll inside a column
 * of their own are clipped by that column long before they reach the viewport,
 * so observing the viewport would only ever fire once the sentinel was already
 * on screen and `rootMargin` would buy nothing.
 */
import { useEffect } from "react"

interface InfiniteScrollProps {
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  loadMoreRef: React.RefObject<HTMLDivElement | null>
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
  // Read flow: derive reusable behavior first, then expose the hook API.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return

    const el = loadMoreRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage()
        }
      },
      {
        root: findScrollParent(el),
        rootMargin: rootMargin,
      },
    )

    if (el) observer.observe(el)

    return () => {
      if (el) observer.unobserve(el)
    }
  })
}

export default useInfiniteScroll
