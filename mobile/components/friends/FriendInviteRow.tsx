/**
 * A distinct, card-like friend row used wherever we list friends with an
 * optional invite affordance and a Letterboxd watch indicator:
 *  - the showtime modal's "Invite friends" panel ("invite" mode),
 *  - the "Watchlisted/Watched by N friends" popups ("invite" mode),
 *  - the movie page's watchlisted/watched friend lists ("display" mode).
 *
 * Leading initial circle + name, an optional watchlisted/watched icon, an
 * optional going/interested status label, and a trailing action that depends on
 * the mode.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

export type FriendWatchStatus = "watchlisted" | "watched" | null;

type FriendInviteRowProps = {
  name: string;
  /** Letterboxd relationship to the film, shown as a small leading icon. */
  watchStatus?: FriendWatchStatus;
  /** "Going" / "Interested" — shown muted on the right in invite mode. */
  statusLabel?: string | null;
  mode?: "invite" | "display";
  /** invite mode: already pinged → shows an "Invited" check instead of add. */
  invited?: boolean;
  /** invite mode: this row is the Enter-key target → shows a return glyph. */
  highlighted?: boolean;
  disabled?: boolean;
  /** invite mode: tapping the row (or the add button) invites the friend. */
  onInvite?: () => void;
  /** display mode: tapping the row navigates (e.g. to the friend's page). */
  onPress?: () => void;
};

const getInitial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

export default function FriendInviteRow({
  name,
  watchStatus = null,
  statusLabel = null,
  mode = "invite",
  invited = false,
  highlighted = false,
  disabled = false,
  onInvite,
  onPress,
}: FriendInviteRowProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const watchIcon =
    watchStatus === "watchlisted"
      ? { name: "schedule" as const, color: colors.orange.secondary }
      : watchStatus === "watched"
        ? { name: "visibility" as const, color: colors.green.secondary }
        : null;

  const isInvite = mode === "invite";
  const handlePress = isInvite ? onInvite : onPress;
  const rowDisabled = disabled || (isInvite && invited) || !handlePress;

  return (
    <TouchableOpacity
      style={[
        styles.row,
        highlighted && styles.rowHighlighted,
        rowDisabled && styles.rowDisabled,
      ]}
      onPress={handlePress ?? undefined}
      disabled={rowDisabled}
      activeOpacity={0.7}
    >
      <View style={styles.avatar}>
        <ThemedText style={styles.avatarText}>{getInitial(name)}</ThemedText>
      </View>
      <ThemedText style={styles.name} numberOfLines={1} ellipsizeMode="tail">
        {name}
      </ThemedText>
      {watchIcon ? (
        <MaterialIcons name={watchIcon.name} size={15} color={watchIcon.color} />
      ) : null}

      {isInvite ? (
        invited ? (
          <View style={styles.invitedTag}>
            <MaterialIcons name="check" size={14} color={colors.green.secondary} />
            <ThemedText style={styles.invitedTagText}>Invited</ThemedText>
          </View>
        ) : statusLabel ? (
          <ThemedText style={styles.statusText}>{statusLabel}</ThemedText>
        ) : highlighted ? (
          <MaterialIcons name="keyboard-return" size={16} color={colors.blue.secondary} />
        ) : (
          <View style={styles.addButton}>
            <MaterialIcons name="add" size={16} color={colors.blue.secondary} />
          </View>
        )
      ) : (
        <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
      )}
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
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    rowHighlighted: {
      borderColor: colors.blue.secondary,
      backgroundColor: colors.blue.primary,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    avatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
    },
    avatarText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
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
    },
    addButton: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.blue.primary,
    },
    invitedTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
    },
    invitedTagText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.green.secondary,
    },
  });
