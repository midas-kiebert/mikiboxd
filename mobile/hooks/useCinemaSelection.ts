/**
 * Which cinemas the feed is showing, and where a change to that gets written.
 *
 * There is one selection either way — the session value every query reads — but
 * two places it survives to the next launch from. A signed-in user's picks live
 * on their account, saved by the cinema-preset flow. A guest's live on the
 * device (see `utils/guest-cinema-selection`), and this is what puts them
 * there, so that every picker in the app persists a guest's choice by doing
 * nothing different from what it already did.
 */
import { useCallback } from "react";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { useIsGuest } from "@/utils/auth-session";
import { saveGuestCinemaSelection } from "@/utils/guest-cinema-selection";

export function useCinemaSelection(): {
  cinemaIds: number[] | undefined;
  setCinemaIds: (next: number[] | undefined) => void;
} {
  const { selections, setSelections } = useSessionCinemaSelections();
  const isGuest = useIsGuest();

  const setCinemaIds = useCallback(
    (next: number[] | undefined) => {
      setSelections(next);
      // `undefined` means "not chosen", which for a guest is the empty list —
      // the stored form of "all cinemas".
      if (isGuest) saveGuestCinemaSelection(next ?? []);
    },
    [isGuest, setSelections]
  );

  return { cinemaIds: selections, setCinemaIds };
}
