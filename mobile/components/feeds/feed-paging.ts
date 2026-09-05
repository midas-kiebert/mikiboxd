/**
 * How the two infinite feeds — showtimes and movies — ask for and render rows.
 *
 * One place because the two lists are the same list with a different card, and
 * the first-page size below is a policy rather than a detail: get it wrong on
 * one feed and it is wrong in a way that is invisible until you are on a
 * mid-range phone wondering why a filter change stutters.
 */
import { Dimensions } from "react-native";
import { useCallback, useEffect, useRef } from "react";

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
 * Both feeds key their rows by id, and hoisting it matters: a new
 * `keyExtractor` on every render is another reason for a list to rebuild cells
 * that have not changed.
 */
export const byIdKeyExtractor = (item: { id: number }) => item.id.toString();

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
 *
 * Which is why `loadMore` has to answer whether it actually started a fetch,
 * and why a debt is only cleared when it did. The first version of this
 * cleared it on the first drag regardless, and that was the whole bug: the
 * guard every caller writes (`hasNextPage && !isFetchingNextPage`) can be
 * false at that exact moment — a page already in flight, a query that has not
 * settled, a list just reset by a pull-to-refresh or a filter change back to
 * the same length it had before. The replay then did nothing, the debt was
 * gone, `onEndReached` stayed disarmed because the content length never
 * changed, and the feed sat on page one for the rest of the session with no
 * spinner and no way back. A debt that survives a failed attempt costs one
 * boolean per drag; the alternative costs the whole list.
 *
 * `onScrollBeginDrag` rather than `onScroll`: it is the finger going down, it
 * fires once per drag, and it costs no per-frame JS.
 *
 * `loadMore` returns `false` when it declined to start a fetch (no next page,
 * or one already in flight), or the promise of the fetch it did start —
 * callers hand back whatever `fetchNextPage()` gives them. That promise is
 * what lets a *failed* attempt re-arm the debt: `fetchNextPage` settles back
 * to `isFetchingNextPage: false` once its retries are exhausted exactly the
 * way a successful page does, and produces no growth in the list either way.
 * Without inspecting the settled result, a failed attempt looks identical to
 * a successful one to this hook — the debt would stay spent, and nothing
 * would ever ask again: `onEndReached` needs the content length to change to
 * refire, and a failed page never grows it.
 */
export function useScrollTriggeredLoadMore(
  loadMore: () => false | Promise<{ isError?: boolean } | unknown>
) {
  const hasScrolled = useRef(false);
  /**
   * An `onEndReached` that has not yet been turned into a fetch — either it
   * arrived before the user had touched the list, it was attempted and the
   * caller was not in a position to act on it, or it was attempted and the
   * fetch that started came back empty-handed.
   */
  const owed = useRef(false);
  // Held in a ref so both handlers keep one identity for the life of the list:
  // callers pass an inline closure over `hasNextPage` and friends, which is a
  // new function every render. Written in an effect rather than in render:
  // both handlers only ever run from a touch, which is long after the commit.
  const latest = useRef(loadMore);
  useEffect(() => {
    latest.current = loadMore;
  });

  /** Tries to spend the debt, and keeps it if the caller could not — or reopens it if the fetch that started came back failed. */
  const attempt = useCallback(() => {
    const result = latest.current();
    if (result === false) {
      owed.current = true;
      return;
    }
    owed.current = false;
    void Promise.resolve(result)
      .then((value) => {
        if (value && typeof value === "object" && (value as { isError?: boolean }).isError) {
          owed.current = true;
        }
      })
      .catch(() => {
        owed.current = true;
      });
  }, []);

  const onScrollBeginDrag = useCallback(() => {
    hasScrolled.current = true;
    if (owed.current) attempt();
  }, [attempt]);

  const onEndReached = useCallback(() => {
    if (!hasScrolled.current) {
      owed.current = true;
      return;
    }
    attempt();
  }, [attempt]);

  /**
   * Puts this back to its just-mounted state: nothing scrolled, nothing owed.
   *
   * A refresh (pull-to-refresh or a tab-bar reselect) replaces the list with a
   * fresh first page, which is exactly the "just landed" situation this hook
   * exists to protect — a short page reads as "the end" the moment it lands.
   * Without this, `hasScrolled` stays true forever after the *first* drag a
   * list ever sees (the pull gesture that started the refresh counts), so
   * every refresh after that one is free to trigger a real page fetch the
   * instant its fresh — and possibly short — first page lands, which showed up
   * as a spinner flashing on for a beat right after the pull-to-refresh one.
   */
  const reset = useCallback(() => {
    hasScrolled.current = false;
    owed.current = false;
  }, []);

  return { onScrollBeginDrag, onEndReached, reset };
}
