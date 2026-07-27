/**
 * The results under a "find a friend" search box.
 *
 * Shared by the first-run intro's friends page and the add-friends tip, which
 * are the same screen twice over and have to behave identically.
 *
 * Three things keep it from jumping around while someone types, which is what
 * this component mostly exists for:
 *  - the query is debounced, so a five-letter name is one request, not five;
 *  - the previous results stay up while the next ones load, so the block never
 *    collapses to a spinner between keystrokes;
 *  - the height is tweened rather than snapped, so the invite card below slides
 *    down to make room instead of being kicked down the page.
 *
 * The spinner therefore only ever appears for the very first search, when there
 * is genuinely nothing to show yet.
 */
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFetchUsers } from "shared/hooks/useFetchUsers";

import FriendCard from "@/components/friends/FriendCard";
import { ThemedText } from "@/components/themed-text";
import AnimatedHeight from "@/components/ui/AnimatedHeight";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useThemeColors } from "@/hooks/use-theme-color";

const SEARCH_DEBOUNCE_MS = 280;
/**
 * Keeps the first spinner and the "no users found" line the same height, so the
 * one turning into the other is not itself a jump.
 */
const STATUS_MIN_HEIGHT = 44;

type UserSearchResultsProps = {
  /** The raw field value; debouncing is this component's business. */
  query: string;
  limit: number;
};

export default function UserSearchResults({ query, limit }: UserSearchResultsProps) {
  // Read flow: local state and data hooks first, then derived values, then JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const normalizedQuery = query.trim();
  const hasQuery = normalizedQuery.length > 0;
  const debouncedQuery = useDebouncedValue(normalizedQuery, SEARCH_DEBOUNCE_MS);
  // Clearing the field collapses the results immediately — waiting out the
  // debounce to remove something the user just deleted feels broken.
  const effectiveQuery = hasQuery ? debouncedQuery : "";

  const { data: usersData, isFetching } = useFetchUsers({
    limit,
    filters: { query: effectiveQuery },
    enabled: effectiveQuery.length > 0,
    keepPreviousResults: true,
  });

  const results = useMemo(() => usersData?.pages[0] ?? [], [usersData]);
  // Typed something, but the request for it has not come back yet.
  const isAwaitingFirstResults = hasQuery && !usersData;
  // Covers the debounce window too, so typing is acknowledged before the
  // request it will eventually cause has even started.
  const isSearchPending = isFetching || (hasQuery && effectiveQuery !== normalizedQuery);

  // Render/output using the state and derived values prepared above.
  return (
    <AnimatedHeight>
      {!hasQuery ? null : isAwaitingFirstResults ? (
        <View style={styles.status}>
          <ActivityIndicator size="small" color={colors.tint} />
        </View>
      ) : results.length === 0 ? (
        <View style={styles.status}>
          <ThemedText style={styles.statusText}>No users found</ThemedText>
        </View>
      ) : (
        <View style={styles.results}>
          {results.map((user) => (
            <FriendCard key={user.id} user={user} showStatusBadge />
          ))}
          {/* A quiet marker that a newer search is on its way, instead of
              tearing down the results that are still perfectly good. */}
          {isSearchPending ? (
            <View style={styles.refreshingRow}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          ) : null}
        </View>
      )}
    </AnimatedHeight>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    status: {
      minHeight: STATUS_MIN_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      paddingTop: 8,
    },
    statusText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
    },
    results: {
      gap: 8,
      paddingTop: 8,
    },
    refreshingRow: {
      alignItems: "center",
      paddingVertical: 4,
    },
  });
