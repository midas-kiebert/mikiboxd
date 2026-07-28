/**
 * One person in a friend list, used wherever we enumerate friends:
 *  - the showtime sheet's "Invite friends" panel ("invite" mode),
 *  - the watchlisted/watched popups (invite mode there, static on a movie page).
 *
 * Colored initial avatar + name, then a trailing action that depends on the mode.
 * In invite mode only the labelled "Invite" button sends the invite — the row
 * itself is inert, so a stray tap on a name can never invite someone by accident.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { getFriendWatchKindMeta, type FriendWatchKind } from "@/components/friends/friend-watch-kind";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";

export type FriendWatchStatus = FriendWatchKind | null;

type FriendListRowProps = {
  /** Drives the avatar tint, so a friend keeps their color across the app. */
  userId: string;
  name: string;
  /** Letterboxd relationship to the film, shown as a small trailing marker. */
  watchStatus?: FriendWatchStatus;
  /** "Going" / "Interested" — shown muted in place of the invite button. */
  statusLabel?: string | null;
  mode?: "invite" | "display";
  /** invite mode: already pinged → shows an "Invited" check instead of the button. */
  invited?: boolean;
  /** invite mode: this row is the Enter-key target → the button shows a return glyph. */
  highlighted?: boolean;
  disabled?: boolean;
  /** invite mode: pressing the Invite button invites the friend. */
  onInvite?: () => void;
  /** display mode: makes the row tappable (e.g. to open the friend's page). */
  onPress?: () => void;
};

export default function FriendListRow({
  userId,
  name,
  watchStatus = null,
  statusLabel = null,
  mode = "invite",
  invited = false,
  highlighted = false,
  disabled = false,
  onInvite,
  onPress,
}: FriendListRowProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const avatarColors = getAvatarColors(userId, colors);
  const watchMeta = watchStatus ? getFriendWatchKindMeta(watchStatus, colors) : null;

  const isInvite = mode === "invite";
  const canInvite = isInvite && !invited && !statusLabel && !disabled && Boolean(onInvite);
  // Only display mode makes the row itself a target; invite mode keeps the tap
  // on the button so nobody invites a friend by tapping their name.
  const rowPress = isInvite ? undefined : onPress;

  // Render/output using the state and derived values prepared above.
  const content = (
    <>
      <View style={[styles.avatar, { backgroundColor: avatarColors.primary }]}>
        <ThemedText style={[styles.avatarText, { color: avatarColors.secondary }]}>
          {getAvatarInitial(name)}
        </ThemedText>
      </View>
      <ThemedText style={styles.name} numberOfLines={1} ellipsizeMode="tail">
        {name}
      </ThemedText>
      {watchMeta ? (
        <MaterialIcons name={watchMeta.icon} size={15} color={watchMeta.accent} />
      ) : null}

      {isInvite ? (
        invited ? (
          <View style={styles.invitedTag}>
            <MaterialIcons name="check" size={14} color={colors.green.secondary} />
            <ThemedText style={styles.invitedTagText}>Invited</ThemedText>
          </View>
        ) : statusLabel ? (
          <ThemedText style={styles.statusText}>{statusLabel}</ThemedText>
        ) : (
          <TouchableOpacity
            style={[styles.inviteButton, !canInvite && styles.inviteButtonDisabled]}
            onPress={onInvite}
            disabled={!canInvite}
            activeOpacity={0.8}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Invite ${name} to this showtime`}
          >
            <MaterialIcons name="mail-outline" size={13} color={colors.blue.secondary} />
            <ThemedText style={styles.inviteButtonText}>Invite</ThemedText>
            {highlighted ? (
              <MaterialIcons name="keyboard-return" size={13} color={colors.blue.secondary} />
            ) : null}
          </TouchableOpacity>
        )
      ) : rowPress ? (
        <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
      ) : null}
    </>
  );

  if (!rowPress) {
    return (
      <View style={[styles.row, highlighted && styles.rowHighlighted, disabled && styles.rowDisabled]}>
        {content}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, highlighted && styles.rowHighlighted, disabled && styles.rowDisabled]}
      onPress={rowPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {content}
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingLeft: 10,
      paddingRight: 8,
      paddingVertical: 7,
    },
    rowHighlighted: {
      borderColor: colors.blue.border,
      backgroundColor: colors.blue.primary,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    avatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 16,
    },
    name: {
      flex: 1,
      minWidth: 0,
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    statusText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
      paddingRight: 4,
    },
    inviteButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 30,
      paddingHorizontal: 10,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.blue.border,
      backgroundColor: colors.blue.primary,
    },
    inviteButtonDisabled: {
      opacity: 0.5,
    },
    inviteButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.blue.secondary,
    },
    invitedTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingRight: 4,
    },
    invitedTagText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.green.secondary,
    },
  });
