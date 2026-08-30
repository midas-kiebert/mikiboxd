/**
 * How the two infinite feeds — showtimes and movies — ask for and render rows.
 *
 * One place because the two lists are the same list with a different card, and
 * the three numbers below are a policy rather than a detail: get one of them
 * wrong on one feed and it is wrong in a way that is invisible until you are
 * on a mid-range phone wondering why a filter change stutters.
 */
import { Dimensions } from "react-native";
import { useCallback, useRef } from "react";

import { MOVIE_ROW_HEIGHT } from "@/components/movies/MovieCard";
import { SHOWTIME_ROW_HEIGHT } from "@/components/showtimes/ShowtimeCard";

/**
 * Spare rows on top of a screenful, for the first page.
 *
 * Small, because the estimate is already generous: it divides the *window*
 * height by the row height, and the search bar, the filter rows and the tab bar
 * all come out of the window before the list gets what is left.
 */
const FIRST_PAGE_SPARE_ROWS = 2;
/** Never fewer than this, whatever the screen says. */
const FIRST_PAGE_MIN = 6;
/** Never more than a normal page — at that point there is nothing to save. */
const FIRST_PAGE_MAX = 20;

/**
 * How many rows the first page should ask for, given what one row occupies.
 *
 * The first page is the one page that is always fetched, and on a filtered
 * feed it is very often the only one anybody looks at — four or five cards fit
 * a phone screen. The rest of a full page is query time, payload, JSON parse
 * and two batched prefetches (visibility and seat availability, both of which
 * run over every loaded showtime) spent on rows nobody scrolls to. Later pages
 * keep their full size: by then the user is scrolling, and a big page is what
 * keeps them from meeting the loader again.
 *
 * Read once, from the window, at module load. A first-page size is a guess
 * about the first screen; it does not need to survive a rotation.
 */
const firstPageLimitForRow = (rowHeight: number): number =>
  Math.min(
    FIRST_PAGE_MAX,
    Math.max(
      FIRST_PAGE_MIN,
      Math.ceil(Dimensions.get("window").height / rowHeight) + FIRST_PAGE_SPARE_ROWS
    )
  );

/** A screenful of showtime cards plus a little. */
export const SHOWTIMES_FIRST_PAGE_LIMIT = firstPageLimitForRow(SHOWTIME_ROW_HEIGHT);
/** A screenful of movie cards plus a little. Taller card, so fewer of them. */
export const MOVIES_FIRST_PAGE_LIMIT = firstPageLimitForRow(MOVIE_ROW_HEIGHT);

/**
 * Both feeds key their rows by id, and hoisting it matters for the same reason
 * the render window does: a new `keyExtractor` on every render is another
 * reason for a list to rebuild cells that have not changed.
 */
export const byIdKeyExtractor = (item: { id: number }) => item.id.toString();

/**
 * How much of the list stays built.
 *
 * `FlatList`'s defaults are 10 initial rows and a 21-viewport window, which for
 * a 128pt row is far more than a page: a twenty-row page ends up mounted in
 * full, every card a set of native views built on the UI thread while whatever
 * caused the fetch is still animating. These cut it to roughly what is on
 * screen plus a screen either side, which is what windowing is for.
 */
export const FEED_RENDER_WINDOW = {
  initialNumToRender: 6,
  maxToRenderPerBatch: 6,
  windowSize: 5,
} as const;

/**
 * `onEndReached`, but only once the user has actually scrolled.
 *
 * A `FlatList` calls `onEndReached` as soon as its content is within the
 * threshold of the end — which, at a threshold of two viewports and a first
 * page sized to one screen, is immediately, before anyone has looked at what
 * arrived. The next page would land unasked for and the short first page would
 * have bought nothing. Loading more is an answer to scrolling, so it waits for
 * some.
 *
 * The swallowed call has to be remembered and replayed, which is the whole
 * reason this is a hook and not an `if`. `VirtualizedList` records the content
 * length it last fired at and will not fire again until that length changes —
 * so a call that is dropped on the floor disarms the list for good: nothing
 * loads, the content never grows, and `onEndReached` is never called again.
 * The first drag therefore hands back whatever was swallowed.
 *
 * `onScrollBeginDrag` rather than `onScroll`: it is the finger going down, it
 * fires once, and it costs no per-frame JS.
 */
export function useScrollTriggeredLoadMore(loadMore: () => void) {
  const hasScrolled = useRef(false);
  /** An `onEndReached` that arrived before the user had touched the list. */
  const owed = useRef(false);
  // Held in a ref so both handlers keep one identity for the life of the list:
  // callers pass an inline closure over `hasNextPage` and friends, which is a
  // new function every render.
  const latest = useRef(loadMore);
  latest.current = loadMore;

  const onScrollBeginDrag = useCallback(() => {
    hasScrolled.current = true;
    if (!owed.current) return;
    owed.current = false;
    latest.current();
  }, []);

  const onEndReached = useCallback(() => {
    if (!hasScrolled.current) {
      owed.current = true;
      return;
    }
    latest.current();
  }, []);

  return { onScrollBeginDrag, onEndReached };
}
