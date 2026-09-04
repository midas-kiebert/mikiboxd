/**
 * The context behind {@link ./FiltersModalProvider}, kept in its own module.
 *
 * Not next to the provider, because the provider renders {@link ./FiltersModal}
 * and that modal needs the hook to open the *cinema* modal alongside itself —
 * so `Provider -> Modal -> Provider` closed a require cycle. Metro allows
 * cycles but warns, and the warning is worth heeding: whichever side loads
 * first sees `undefined` for the other's module-scope bindings, which for a
 * `createContext` call is a fault that only shows up as a component reading
 * defaults it should never have seen.
 *
 * A context object has no dependencies of its own, so hoisting it here breaks
 * the cycle outright rather than papering over it: both sides now depend on
 * this module and neither on the other. Same reasoning as
 * `components/sheets/sheet-timing.ts`.
 */
import { createContext, useContext } from 'react';

import type { OpenCinemaModalOptions } from '@/components/filters/CinemaFilterModal';

/** Which of the modal's optional sections to reveal when it opens. */
export type OpenConfig = { showGroupByMovie?: boolean; showPresets?: boolean };

export type FiltersModalContextValue = {
  openFiltersModal: (config?: OpenConfig) => void;
  openCinemaModal: (options?: OpenCinemaModalOptions) => void;
};

/**
 * Defaults are no-ops rather than a throwing "used outside a provider" guard:
 * some screens deliberately render filter controls outside the provider and
 * pass their own opener instead (see `FiltersModal`'s prop of the same name).
 */
export const FiltersModalContext = createContext<FiltersModalContextValue>({
  openFiltersModal: () => {},
  openCinemaModal: () => {},
});

export function useFiltersModal() {
  return useContext(FiltersModalContext);
}
