/**
 * One person in a friend list, used wherever we enumerate friends:
 *  - the showtime sheet's "Invite friends" panel ("invite" mode),
 *  - the watchlisted/watched popups (invite mode there, static on a movie page).
 *
 * Colored initial avatar + name, then a trailing action that depends on the mode.
 * In invite mode only the labelled "Invite" button sends the invite; the row
 * itself never does, so a stray tap on a name can never invite someone by
 * accident — but when a caller passes `onPress`, the row still opens that
 * person's page, in either mode.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { getFriendWatchKindMeta, type FriendWatchKind } from "@/components/friends/friend-watch-kind";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";

export type FriendWatchStatus = FriendWatchKind | null;
export type FriendPingStatus = "GOING" | "INTERESTED" | null;

type FriendListRowProps = {
  /** Drives the avatar tint, so a friend keeps their color across the app. */
  userId: string;
  name: string;
  /** Letterboxd relationship to the film, shown as a small trailing marker. */
  watchStatus?: FriendWatchStatus;
  /**
   * invite mode: already going/interested on their own — tints the row the
   * same green/orange as the showtime sheet's own status, rather than a text
   * label, so it reads the same way at a glance everywhere in the app.
   */
  pingStatus?: FriendPingStatus;
  mode?: "invite" | "display" | "remind";
  /** invite mode: already pinged → shows an "Invited" check instead of the button. */
  invited?: boolean;
  /** remind mode: a reminder was just sent → shows a "Sent" check instead of the button. */
  reminded?: boolean;
  /** invite mode: this row is the Enter-key target → the button shows a return glyph. */
  highlighted?: boolean;
  disabled?: boolean;
  /** invite mode: pressing the Invite button invites the friend. */
  onInvite?: () => void;
  /** remind mode: pressing the Remind button nudges the friend. */
  onRemind?: () => void;
  /** display mode: makes the row tappable (e.g. to open the friend's page). */
  onPress?: () => void;
};

export default function FriendListRow({
  userId,
  name,
  watchStatus = null,
  pingStatus = null,
  mode = "invite",
  invited = false,
  reminded = false,
  highlighted = false,
  disabled = false,
  onInvite,
  onRemind,
  onPress,
}: FriendListRowProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const avatarColors = getAvatarColors(userId, colors);
  const watchMeta = watchStatus ? getFriendWatchKindMeta(watchStatus, colors) : null;
  // Same green/orange the showtime sheet itself uses for going/interested.
  const pingStatusPalette =
    pingStatus === "GOING" ? colors.green : pingStatus === "INTERESTED" ? colors.orange : null;

  const isInvite = mode === "invite";
  const isRemind = mode === "remind";
  // A friend already going/interested can still be invited — it just won't
  // notify them — so the row is tinted for context but the button stays live.
  const canInvite = isInvite && !invited && !disabled && Boolean(onInvite);
  const canRemind = isRemind && !reminded && !disabled && Boolean(onRemind);
  // The row itself always opens the friend's page when a handler is given —
  // in invite mode that's a separate action from the labelled Invite button
  // (which stops its own press from reaching the row), so nobody invites a
  // friend by tapping their name.
  const rowPress = onPress;

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
          <View style={[styles.inviteButton, styles.invitedButton]}>
            <MaterialIcons name="check" size={13} color={colors.textSecondary} />
            <ThemedText style={styles.invitedButtonText}>Invited</ThemedText>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.inviteButton, !canInvite && styles.inviteButtonDisabled]}
            onPress={(event) => {
              event.stopPropagation();
              onInvite?.();
            }}
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
      ) : isRemind ? (
        reminded ? (
          <View style={[styles.inviteButton, styles.invitedButton]}>
            <MaterialIcons name="check" size={13} color={colors.textSecondary} />
            <ThemedText style={styles.invitedButtonText}>Sent</ThemedText>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.inviteButton, !canRemind && styles.inviteButtonDisabled]}
            onPress={(event) => {
              event.stopPropagation();
              onRemind?.();
            }}
            disabled={!canRemind}
            activeOpacity={0.8}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Send ${name} a reminder about this showtime`}
          >
            <MaterialIcons name="notifications-active" size={13} color={colors.blue.secondary} />
            <ThemedText style={styles.inviteButtonText}>Remind</ThemedText>
          </TouchableOpacity>
        )
      ) : rowPress ? (
        <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
      ) : null}
    </>
  );

  const rowStyle = [
    styles.row,
    pingStatusPalette && {
      borderColor: pingStatusPalette.border,
      backgroundColor: pingStatusPalette.primary,
    },
    // The search-highlight tint is a temporary, more urgent signal than a
    // standing going/interested status, so it wins when both apply.
    highlighted && styles.rowHighlighted,
    disabled && styles.rowDisabled,
  ];

  if (!rowPress) {
    return <View style={rowStyle}>{content}</View>;
  }

  return (
    <TouchableOpacity style={rowStyle} onPress={rowPress} disabled={disabled} activeOpacity={0.7}>
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
    invitedButton: {
      borderColor: colors.cardBorder,
      backgroundColor: colors.surfaceMuted,
    },
    invitedButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
  });
