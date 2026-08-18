/**
 * Which cinemas the feed is showing, and where a change to that gets written.
 *
 * There is one selection either way — the session value every query reads — but
 * two places it survives to the next launch from. A signed-in user's picks live
 * on their account, saved by the cinema-preset flow. A guest's live on the
 * device (see `utils/guest-cinema-selection`), and this is what puts them
 * there, so that every picker in the app persists a guest's choice by doing
 * nothing different from what it already did.
 *
 * An empty selection never survives this. The backend reads "no cinema ids" as
 * "don't filter by cinema", so an empty list already behaved as every cinema —
 * but only the server knew that, and the app went on reporting "0 cinemas" over
 * a feed that was plainly showing all of them. Emptiness is resolved to the
 * full list here, at the one place a selection is written, so the rest of the
 * app only ever sees a selection that says what the feed is doing.
 */
import { useCallback } from "react";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { useIsGuest } from "@/utils/auth-session";
import { saveGuestCinemaSelection } from "@/utils/guest-cinema-selection";

export function useCinemaSelection(): {
  cinemaIds: number[] | undefined;
  setCinemaIds: (next: number[] | undefined) => void;
} {
  const { selections, setSelections } = useSessionCinemaSelections();
  const { data: allCinemas } = useFetchCinemas();
  const isGuest = useIsGuest();

  const setCinemaIds = useCallback(
    (next: number[] | undefined) => {
      // `undefined` means "not chosen yet", which is not the same as choosing
      // nothing and must keep its meaning — the seeding in useSharedTabFilters
      // reads it to decide whether there is anything to seed.
      const resolved =
        next !== undefined && next.length === 0 && allCinemas && allCinemas.length > 0
          ? allCinemas.map((cinema) => cinema.id)
          : next;
      setSelections(resolved);
      if (isGuest) saveGuestCinemaSelection(resolved ?? []);
    },
    [allCinemas, isGuest, setSelections]
  );

  return { cinemaIds: selections, setCinemaIds };
}
