/**
 * Feature tip: the user has no Letterboxd username, so the watchlist and
 * already seen filters do nothing for them. Takes the username inline, since
 * sending someone to Settings for a single text field is a poor trade.
 *
 * Once saved it asks, like the intro, whether the Letterboxd avatar
 * may be used as the avatar, previewing the picture the save already fetched.
 * Off unless the user says yes; if yes brings no picture back, it says why.
 * Skipped when the account doesn't exist or the picture is already on.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and saves.
 */
import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import useLetterboxdAvatarPreference from "shared/hooks/useLetterboxdAvatarPreference";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import PersonAvatar from "@/components/ui/PersonAvatar";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSaveLetterboxdUsername } from "@/hooks/useSaveLetterboxdUsername";
import { useDismissTip } from "@/utils/feature-tips";

export default function LetterboxdUsernameTip() {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("letterboxd-username");
  const currentUser = useCurrentUser();
  const avatarPreference = useLetterboxdAvatarPreference();
  const [username, setUsername] = useState("");
  // Saving normally makes the tip ineligible, but the steps after it are shown
  // anyway so the dialog never disappears the moment the user presses save.
  const [step, setStep] = useState<Step>("username");
  const [isAccountMissing, setIsAccountMissing] = useState(false);

  const saveMutation = useSaveLetterboxdUsername();

  const trimmedUsername = username.trim();

  const handleSave = useCallback(() => {
    if (!trimmedUsername) return;
    saveMutation.mutate(trimmedUsername, {
      onSuccess: (updated) => {
        const accountMissing = updated.letterboxd_account_not_found === true;
        setIsAccountMissing(accountMissing);
        setStep(accountMissing || updated.use_letterboxd_avatar ? "saved" : "picture");
      },
    });
  }, [saveMutation, trimmedUsername]);

  const handleUsePicture = useCallback(() => {
    avatarPreference
      .enable()
      .then((updated) => setStep(updated.letterboxd_avatar_url ? "picture-on" : "picture-missing"))
      // The hook rolls the switch back; the username itself is saved.
      .catch(() => setStep("saved"));
  }, [avatarPreference]);

  // Render/output using the state and handlers prepared above.
  if (step === "picture" && currentUser) {
    return (
      <FeatureTipModal
        tipId="letterboxd-username"
        icon="account-circle"
        title="Use your Letterboxd avatar?"
        message={
          avatarPreference.pictureUrl
            ? "Username saved. Show your Letterboxd avatar to friends on MiKiNO instead of a coloured initial?"
            : "Username saved. Show your Letterboxd avatar to friends on MiKiNO instead of a coloured initial? We'll fetch it from Letterboxd as soon as you say yes."
        }
        actionLabel="Use my avatar"
        onAction={handleUsePicture}
        isActionBusy={avatarPreference.isSaving}
        secondaryActionLabel="Not now"
        onSecondaryAction={() => setStep("saved")}
        hideDismissForever
        onDismiss={dismissTip}
      >
        <View style={styles.avatarPreview}>
          <PersonAvatar
            userId={currentUser.id}
            name={currentUser.display_name ?? ""}
            avatarUrl={avatarPreference.pictureUrl}
            size={AVATAR_PREVIEW_SIZE}
            fontSize={28}
          />
          <ThemedText style={styles.avatarNote}>
            You can change this any time in Settings → Letterboxd.
          </ThemedText>
        </View>
      </FeatureTipModal>
    );
  }

  if (step === "picture-missing") {
    return (
      <FeatureTipModal
        tipId="letterboxd-username"
        icon="account-circle"
        title="No avatar found"
        message={`Letterboxd didn't give us an avatar for "${trimmedUsername}": either the account has none, or Letterboxd couldn't be reached just now. Your coloured initial is used for now; if you add one later, your avatar updates by itself.`}
        actionLabel="Done"
        closeOnAction
        hideDismissForever
        onDismiss={dismissTip}
      />
    );
  }

  if (step !== "username") {
    return (
      <FeatureTipModal
        tipId="letterboxd-username"
        icon={isAccountMissing ? "warning" : "check-circle"}
        title="Letterboxd username saved"
        message={
          isAccountMissing
            ? `We couldn't find a Letterboxd account called "${trimmedUsername}". Check the spelling in Settings → Letterboxd, or your watchlist won't sync.`
            : step === "picture-on"
              ? "Friends now see your Letterboxd avatar. Your watchlist will sync shortly; after that you can filter screenings down to it, or hide films you have already seen."
              : "Your watchlist will sync shortly. After that you can filter screenings down to your watchlist, or hide films you have already seen."
        }
        actionLabel="Done"
        closeOnAction
        hideDismissForever
        onDismiss={dismissTip}
      />
    );
  }

  return (
    <FeatureTipModal
      tipId="letterboxd-username"
      icon="bookmark-added"
      title="Connect your Letterboxd watchlist"
      message="Add your Letterboxd username to MiKiNO to use your watchlist as a filter, or to hide films you have already seen."
      actionLabel="Save username"
      onAction={handleSave}
      isActionDisabled={!trimmedUsername}
      isActionBusy={saveMutation.isPending}
      onDismiss={dismissTip}
      helpLabel="Where do I find my username?"
      helpContent={
        <>
          <View style={styles.helpItem}>
            <ThemedText style={styles.helpItemTitle}>On the website</ThemedText>
            <ThemedText style={styles.helpItemText}>
              Open your profile and read the address bar. In letterboxd.com/yourname, your username
              is the part after the slash.
            </ThemedText>
          </View>
          <View style={styles.helpItem}>
            <ThemedText style={styles.helpItemTitle}>In the Letterboxd app</ThemedText>
            <ThemedText style={styles.helpItemText}>
              Open your profile and tap the three dots in the top right corner. Your username is the
              grayed out name.
            </ThemedText>
          </View>
        </>
      }
    >
      <View style={styles.field}>
        <ThemedText style={styles.fieldLabel}>Letterboxd username</ThemedText>
        <View style={styles.inputRow}>
          <ThemedText style={styles.prefix}>letterboxd.com/</ThemedText>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSave}
            editable={!saveMutation.isPending}
          />
        </View>
      </View>
    </FeatureTipModal>
  );
}

type Step = "username" | "picture" | "picture-on" | "picture-missing" | "saved";

const AVATAR_PREVIEW_SIZE = 72;

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    field: {
      gap: 6,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 12,
      backgroundColor: colors.background,
    },
    prefix: {
      // Same size as the input so the prefix and what is typed read as one URL.
      fontSize: 16,
      color: colors.textSecondary,
    },
    input: {
      flex: 1,
      // Butts straight up against the "letterboxd.com/" prefix, so the two read
      // as one URL. Android gives TextInput horizontal padding by default.
      paddingLeft: 0,
      paddingRight: 12,
      paddingVertical: 13,
      fontSize: 16,
      color: colors.text,
    },
    avatarPreview: {
      alignItems: "center",
      gap: 10,
    },
    avatarNote: {
      fontSize: 13,
      textAlign: "center",
      color: colors.textSecondary,
    },
    helpItem: {
      gap: 3,
    },
    helpItemTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    helpItemText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
  });
