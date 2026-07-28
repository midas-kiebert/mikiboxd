/**
 * Intro page 4 — add friends.
 *
 * Same two routes as `AddFriendsTip`: search for someone by name, or let them
 * scan (or open) your invite link. The QR code is the point of the page — this
 * is the one moment the user is likely to be sitting next to the friend who
 * told them about the app.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MeService } from "shared";
import QRCode from "react-native-qrcode-svg";

import ShareInviteLinkButton from "@/components/friends/ShareInviteLinkButton";
import UserSearchResults from "@/components/friends/UserSearchResults";
import SearchBar from "@/components/inputs/SearchBar";
import IntroPageShell from "@/components/intro/IntroPageShell";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildFriendInviteUrl } from "@/constants/friend-invite";

const SEARCH_RESULT_LIMIT = 5;
const QR_CODE_SIZE = 150;

export default function IntroFriendsPage({ onDone }: { onDone: () => void }) {
  // Read flow: local state and data hooks first, then derived values, then JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const [searchQuery, setSearchQuery] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => MeService.getCurrentUser(),
  });

  const inviteUrl = useMemo(
    () => (currentUser?.id ? buildFriendInviteUrl(currentUser.id) : null),
    [currentUser?.id]
  );
  const inviteUsername = useMemo(
    () => currentUser?.display_name?.trim() || null,
    [currentUser?.display_name]
  );

  // Render/output using the state and derived values prepared above.
  return (
    <IntroPageShell
      icon="group-add"
      title="Add your friends"
      message="See each other's showtimes, send invites, and keep track of who's going where."
      primaryLabel="Finish"
      onPrimary={onDone}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Grouped so the results hang off the search box, rather than picking
            up the gap that separates it from the invite card below. */}
        <View>
          {/* Unpadded: this page owns its own gutter, and the search box has to
              line up with the invite card below it rather than sit wider. */}
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search for a friend"
            containerStyle={styles.searchBar}
          />
          <UserSearchResults query={searchQuery} limit={SEARCH_RESULT_LIMIT} />
        </View>

        <View style={styles.inviteCard}>
          <ThemedText style={styles.inviteHint}>Or let a friend scan this</ThemedText>
          {inviteUsername ? (
            <ThemedText style={styles.inviteUsername}>{inviteUsername}</ThemedText>
          ) : null}
          {inviteUrl ? (
            <View style={styles.qrWrapper}>
              <QRCode
                value={inviteUrl}
                size={QR_CODE_SIZE}
                backgroundColor="#ffffff"
                color="#111111"
              />
            </View>
          ) : (
            <View style={styles.qrLoadingWrapper}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          )}
          <ShareInviteLinkButton inviteUrl={inviteUrl} />
        </View>
      </ScrollView>
    </IntroPageShell>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    content: {
      gap: 14,
      paddingBottom: 8,
    },
    searchBar: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      backgroundColor: "transparent",
    },
    inviteCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      paddingHorizontal: 10,
      gap: 8,
    },
    inviteHint: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
    },
    inviteUsername: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
      textAlign: "center",
    },
    qrWrapper: {
      borderRadius: 12,
      padding: 6,
      backgroundColor: "#ffffff",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    qrLoadingWrapper: {
      width: QR_CODE_SIZE,
      height: QR_CODE_SIZE,
      borderRadius: 12,
      backgroundColor: colors.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
  });
