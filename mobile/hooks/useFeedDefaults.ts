/**
 * The defaults the feeds open with: feed style (screenings or films) and
 * language. Cinemas have their own default — the account's preferred cinemas —
 * and nothing else has one; every other filter opens off.
 *
 * The same model as the website's filter rail (`use-remembered-language`,
 * `use-remembered-feed-style`): **only "Make this the default" writes it.**
 * Flipping the control, applying a quick filter or clearing the filters all
 * change this visit alone, so a one-off change never quietly becomes tomorrow's
 * starting point. Clearing puts language back to its default and leaves the
 * feed style alone — a view, not a filter.
 *
 * Kept on this device, like the website's: the account has nowhere to store
 * them yet. Applied once at startup by `useSharedTabFilters`.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { storage } from "shared/storage";
import type { Language } from "shared/client";

const STORAGE_KEY = "feed_defaults_v1";
const FEED_DEFAULTS_QUERY_KEY = ["feed-defaults"] as const;

export type FeedDefaults = {
  groupByMovie: boolean;
  languages: Language[];
};

const EMPTY_DEFAULTS: FeedDefaults = { groupByMovie: false, languages: [] };

const isLanguage = (value: unknown): value is Language => value === "nl" || value === "en";

const loadFeedDefaults = async (): Promise<FeedDefaults> => {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_DEFAULTS;
    const { groupByMovie, languages } = parsed as Record<string, unknown>;
    return {
      groupByMovie: groupByMovie === true,
      languages: Array.isArray(languages) ? languages.filter(isLanguage) : [],
    };
  } catch {
    return EMPTY_DEFAULTS;
  }
};

export const sameLanguages = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry) => b.includes(entry));

export function useFeedDefaults() {
  const queryClient = useQueryClient();
  const { data, isFetched } = useQuery({
    queryKey: FEED_DEFAULTS_QUERY_KEY,
    queryFn: loadFeedDefaults,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const defaults = data ?? EMPTY_DEFAULTS;

  const write = useCallback(
    (patch: Partial<FeedDefaults>) => {
      const next = {
        ...(queryClient.getQueryData<FeedDefaults>(FEED_DEFAULTS_QUERY_KEY) ?? EMPTY_DEFAULTS),
        ...patch,
      };
      queryClient.setQueryData(FEED_DEFAULTS_QUERY_KEY, next);
      storage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
    },
    [queryClient]
  );

  const setDefaultGroupByMovie = useCallback(
    (groupByMovie: boolean) => write({ groupByMovie }),
    [write]
  );
  const setDefaultLanguages = useCallback(
    (languages: readonly Language[]) => write({ languages: languages.filter(isLanguage) }),
    [write]
  );

  return {
    defaultGroupByMovie: defaults.groupByMovie,
    defaultLanguages: defaults.languages,
    isLoaded: isFetched,
    setDefaultGroupByMovie,
    setDefaultLanguages,
  };
}
