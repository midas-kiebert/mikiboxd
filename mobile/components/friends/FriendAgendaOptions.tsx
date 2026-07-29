/**
 * The per-friend controls the Friends tab offers on a `FriendCard` — "who can
 * see my showtimes" and "remove friend" — repeated here on that same friend's
 * agenda screen. A visit here already means the user is thinking about this
 * one friend specifically, so these controls belong within reach instead of
 * being a trip back to the Friends tab away.
 *
 * Deliberately not a `FriendCard`: this screen's own top bar already carries
 * the friend's name, so the card would just repeat it. Same building blocks
 * (`FriendVisibilityControl`, the remove confirm dialog, `useFriendActions`)
 * as the Friends tab, so the two places can never drift out of sync.
 *
 * Removing a friend is rare and consequential, so unlike the visibility
 * control it gets no label and no colour of its own — a small muted icon in
 * the control's own label line, deliberately anchored there rather than
 * floating loose next to it. The confirm dialog still carries the full
 * warning.
 */
import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FriendVisibilityControl from "@/components/friends/FriendVisibilityControl";
import { useFriendActions } from "@/hooks/useFriendActions";
import { useFriendStatusSharing } from "@/hooks/useFriendStatusSharing";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type FriendAgendaOptionsProps = {
  friendId: string;
  friendName: string;
  sharesStatus: boolean;
};

export default function FriendAgendaOptions({
  friendId,
  friendName,
  sharesStatus,
}: FriendAgendaOptionsProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();

  const [isRemoveDialogVisible, setIsRemoveDialogVisible] = useState(false);
  const { removeFriend, isBusy } = useFriendActions();
  const { sharesStatus: displayedSharesStatus, change: changeStatusSharing } =
    useFriendStatusSharing(friendId, sharesStatus);

  const handleRemovePress = () => {
    if (isBusy) return;
    triggerSelectionHaptic();
    setIsRemoveDialogVisible(true);
  };

  const handleConfirmRemove = () => {
    setIsRemoveDialogVisible(false);
    removeFriend(friendId);
    // The agenda behind this friend disappears the moment they are no longer a
    // friend, so leave the screen right away rather than leaving the user on a
    // page they can no longer see.
    router.back();
  };

  return (
    <View style={styles.card}>
      <FriendVisibilityControl
        sharesStatus={displayedSharesStatus}
        onChange={changeStatusSharing}
        disabled={isBusy}
        trailingAccessory={
          <TouchableOpacity
            style={styles.removeIconButton}
            onPress={handleRemovePress}
            disabled={isBusy}
            activeOpacity={0.6}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${friendName} as a friend`}
          >
            <MaterialIcons name="person-remove-alt-1" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        }
      />
      <ConfirmDialog
        visible={isRemoveDialogVisible}
        icon="person-remove-alt-1"
        title={`Remove ${friendName}?`}
        message="You will no longer see each other's showtimes, and neither of you can send invites until you are friends again."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={handleConfirmRemove}
        onCancel={() => setIsRemoveDialogVisible(false)}
      />
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    // No label, no colour of its own: this is the one action here meant to be
    // stumbled on rarely, not read as an equal peer of the visibility control.
    // Sized to the label line it sits on rather than the taller control below.
    removeIconButton: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      opacity: 0.6,
    },
  });
