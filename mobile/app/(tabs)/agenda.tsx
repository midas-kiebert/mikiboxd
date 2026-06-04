/**
 * Expo Router screen/module for (tabs) / agenda. Shows the user's personal agenda:
 * showtimes they are going to / interested in, plus showtimes they've been invited
 * to. Interested + invites can be toggled on/off; going is always shown.
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { MeService } from "shared";
import { useFetchAgenda } from "shared/hooks/useFetchAgenda";

import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import { ShowtimesListContent } from "@/components/showtimes/ShowtimesScreen";
import { triggerLongPressHaptic } from "@/utils/long-press";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildSnapshotTime, refreshInfiniteQueryWithFreshSnapshot } from "@/utils/reset-infinite-query";

type ThemeColors = typeof import("@/constants/theme").Colors.light;
type StatusColor = ThemeColors["orange"];

/**
 * A pill toggle that matches the app's filter pills: filled with the category
 * colour when on, a muted outline when off. The fill-vs-outline contrast (and
 * the leading icon switching between its filled/outline form) signals on/off.
 */
function AgendaToggle({
  label,
  iconOn,
  iconOff,
  active,
  accent,
  onPress,
  colors,
  styles,
}: {
  label: string;
  iconOn: React.ComponentProps<typeof MaterialIcons>["name"];
  iconOff: React.ComponentProps<typeof MaterialIcons>["name"];
  active: boolean;
  accent: StatusColor;
  onPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${active ? "Hide" : "Show"} ${label.toLowerCase()}`}
      style={[
        styles.toggle,
        active
          ? { backgroundColor: accent.primary, borderColor: accent.primary }
          : { backgroundColor: colors.pillBackground, borderColor: colors.cardBorder },
      ]}
    >
      <MaterialIcons
        name={active ? iconOn : iconOff}
        size={15}
        color={active ? accent.secondary : colors.textSecondary}
      />
      <ThemedText
        style={[
          styles.toggleLabel,
          { color: active ? accent.secondary : colors.textSecondary },
        ]}
      >
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

export default function AgendaScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const [includeInterested, setIncludeInterested] = useState(true);
  const [includeInvited, setIncludeInvited] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState(() => buildSnapshotTime());

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useFetchAgenda({
    limit: 20,
    snapshotTime,
    includeInterested,
    includeInvited,
    enabled: isFocused,
  });

  const showtimes = useMemo(() => data?.pages.flat() ?? [], [data]);

  // Mark received invites as seen as soon as the agenda is viewed, clearing the badge.
  const markSeenMutation = useMutation({
    mutationFn: () => MeService.markMyShowtimePingsSeen(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] });
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] });
    },
    onError: (error) => {
      console.error("Error marking showtime invites as seen:", error);
    },
  });

  useEffect(() => {
    if (!isFocused) return;
    markSeenMutation.mutate();
    // Trigger once when this tab gains focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshInfiniteQueryWithFreshSnapshot({
        queryClient,
        queryKey: ["showtimes", "agenda", { includeInterested, includeInvited }],
        setSnapshotTime,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const toggleInterested = () => {
    triggerLongPressHaptic();
    setIncludeInterested((previous) => !previous);
  };

  const toggleInvited = () => {
    triggerLongPressHaptic();
    setIncludeInvited((previous) => !previous);
  };

  const emptyText =
    !includeInterested && !includeInvited
      ? "No showtimes you're going to yet"
      : "Nothing in your agenda yet";

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar title="Agenda" />
      <View style={styles.toggleRow}>
        <AgendaToggle
          label="Interested"
          iconOn="bookmark"
          iconOff="bookmark-border"
          active={includeInterested}
          accent={colors.orange}
          onPress={toggleInterested}
          colors={colors}
          styles={styles}
        />
        <AgendaToggle
          label="Invites"
          iconOn="mail"
          iconOff="mail-outline"
          active={includeInvited}
          accent={colors.blue}
          onPress={toggleInvited}
          colors={colors}
          styles={styles}
        />
      </View>
      <ShowtimesListContent
        showtimes={showtimes}
        isLoading={isLoading}
        isFetching={isFetching}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        onLoadMore={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        emptyText={emptyText}
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    toggleRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    toggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 18,
      borderWidth: 1,
    },
    toggleLabel: {
      fontSize: 13,
      fontWeight: "500",
    },
  });
