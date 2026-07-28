/**
 * Feature tip: the user has no friends yet, so friend showtimes, invites and
 * shared status have nothing to show. Bundles every way to add someone in one
 * place: scan/share the user's own invite QR code, or search for a person
 * directly.
 *
 * Deliberately the same layout, search box and results block as the intro's
 * friends page — they ask for the same thing, and only one of them should ever
 * be seen, so any difference between the two would read as a bug.
 *
 * Eligibility lives in `FeatureTipsHost`; this component only renders.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MeService } from "shared";
import QRCode from "react-native-qrcode-svg";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import ShareInviteLinkButton from "@/components/friends/ShareInviteLinkButton";
import UserSearchResults from "@/components/friends/UserSearchResults";
import SearchBar from "@/components/inputs/SearchBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { buildFriendInviteUrl } from "@/constants/friend-invite";
import { useDismissTip } from "@/utils/feature-tips";

const SEARCH_RESULT_LIMIT = 5;
const QR_CODE_SIZE = 160;

export default function AddFriendsTip() {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("add-friends");

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
    <FeatureTipModal
      tipId="add-friends"
      icon="group-add"
      title="Add your friends"
      message="See each other's showtimes, send invites, and keep track of who's going where."
      actionLabel="Done"
      closeOnAction
      onDismiss={dismissTip}
    >
      {/* Grouped so the results hang off the search box rather than picking up
          the dialog's own spacing. */}
      <View>
        {/* Unpadded: the dialog owns its gutter, and the search box has to line
            up with the invite card below it rather than sit wider. */}
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search for a friend"
          containerStyle={styles.searchBar}
        />
        <UserSearchResults query={searchQuery} limit={SEARCH_RESULT_LIMIT} />
      </View>

      <View style={styles.inviteCard}>
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
    </FeatureTipModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    searchBar: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      backgroundColor: "transparent",
    },
    inviteCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 10,
      paddingHorizontal: 10,
      gap: 8,
    },
    inviteUsername: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textSecondary,
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
