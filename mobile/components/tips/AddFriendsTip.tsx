/**
 * Feature tip: the user has no friends yet, so friend showtimes, invites and
 * shared status have nothing to show. Bundles every way to add someone in one
 * place: scan/share the user's own invite QR code, or search for a person
 * directly.
 *
 * Eligibility lives in `FeatureTipsHost`; this component only renders.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MeService } from "shared";
import { useFetchUsers } from "shared/hooks/useFetchUsers";
import QRCode from "react-native-qrcode-svg";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import FriendCard from "@/components/friends/FriendCard";
import ShareInviteLinkButton from "@/components/friends/ShareInviteLinkButton";
import SearchBar from "@/components/inputs/SearchBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildFriendInviteUrl } from "@/constants/friend-invite";
import { useDismissTip } from "@/utils/feature-tips";

const SEARCH_RESULT_LIMIT = 5;

export default function AddFriendsTip() {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("add-friends");

  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim();
  const hasQuery = normalizedQuery.length > 0;

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => MeService.getCurrentUser(),
  });
  const { data: usersData, isFetching: isSearching } = useFetchUsers({
    limit: SEARCH_RESULT_LIMIT,
    filters: { query: normalizedQuery },
    enabled: hasQuery,
  });

  const inviteUrl = useMemo(
    () => (currentUser?.id ? buildFriendInviteUrl(currentUser.id) : null),
    [currentUser?.id]
  );
  const inviteUsername = useMemo(
    () => currentUser?.display_name?.trim() || null,
    [currentUser?.display_name]
  );
  const results = useMemo(() => usersData?.pages[0] ?? [], [usersData]);

  // Render/output using the state and derived values prepared above.
  return (
    <FeatureTipModal
      icon="group-add"
      title="Add your friends"
      message="See each other's showtimes, send invites, and keep track of who's going where."
      actionLabel="Done"
      closeOnAction
      onDismiss={dismissTip}
    >
      <View style={styles.searchSection}>
        <ThemedText style={styles.searchLabel}>Search for someone</ThemedText>
        <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search users" />
        {hasQuery ? (
          isSearching ? (
            <View style={styles.searchStatus}>
              <ActivityIndicator size="small" color={colors.tint} />
            </View>
          ) : results.length === 0 ? (
            <ThemedText style={styles.searchStatusText}>No users found</ThemedText>
          ) : (
            <View style={styles.results}>
              {results.map((user) => (
                <FriendCard key={user.id} user={user} showStatusBadge />
              ))}
            </View>
          )
        ) : null}
      </View>

      <View style={styles.inviteCard}>
        {inviteUsername ? (
          <ThemedText style={styles.inviteUsername}>{inviteUsername}</ThemedText>
        ) : null}
        {inviteUrl ? (
          <View style={styles.qrWrapper}>
            <QRCode value={inviteUrl} size={160} backgroundColor="#ffffff" color="#111111" />
          </View>
        ) : (
          <View style={styles.qrLoadingWrapper}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        )}
        <ThemedText style={styles.inviteText}>
          Or let a friend scan this, or share your invite link.
        </ThemedText>
        <ShareInviteLinkButton inviteUrl={inviteUrl} />
      </View>
    </FeatureTipModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    inviteCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 16,
      paddingHorizontal: 12,
      gap: 10,
    },
    inviteUsername: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textSecondary,
      textAlign: "center",
    },
    qrWrapper: {
      borderRadius: 12,
      padding: 10,
      backgroundColor: "#ffffff",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    qrLoadingWrapper: {
      width: 160,
      height: 160,
      borderRadius: 12,
      backgroundColor: colors.pillBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    inviteText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
    },
    searchSection: {
      gap: 8,
      // SearchBar carries its own horizontal padding, meant for full-bleed
      // screens; cancel it out so it lines up with the rest of the dialog.
      marginHorizontal: -24,
    },
    searchLabel: {
      paddingHorizontal: 24,
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
      textAlign: "center",
    },
    searchStatus: {
      paddingVertical: 10,
      alignItems: "center",
    },
    searchStatusText: {
      paddingHorizontal: 18,
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
    },
    results: {
      paddingHorizontal: 24,
      gap: 8,
    },
  });
