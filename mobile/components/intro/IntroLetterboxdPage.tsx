/**
 * Intro page 2 — connect Letterboxd.
 *
 * Takes the username inline, exactly like `LetterboxdUsernameTip`, and offers
 * the honest way out: plenty of people don't use Letterboxd at all. Saying so
 * retires that tip for good, so the app never nags about a service the user has
 * already told it they don't have.
 *
 * Once the username saves, the page turns into the question whether the
 * Letterboxd profile picture may be used as the avatar — a page of its own
 * with the picture in the middle, not a switch under the field, so it is
 * actually seen. Off unless the user says yes; saying yes makes the backend
 * fetch the picture right away. If none comes back (no such account, or no
 * picture on it) a short note says so before moving on; the switch stays on,
 * so a picture added later shows up by itself.
 *
 * The "where do I find it?" help is open rather than collapsed here — the page
 * has the room, and a first-time user is exactly who needs it.
 */
import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import useLetterboxdAvatarPreference from "shared/hooks/useLetterboxdAvatarPreference";

import IntroPageShell from "@/components/intro/IntroPageShell";
import { ThemedText } from "@/components/themed-text";
import PersonAvatar from "@/components/ui/PersonAvatar";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSaveLetterboxdUsername } from "@/hooks/useSaveLetterboxdUsername";
import { dismissTipForever } from "@/utils/feature-tips";

export default function IntroLetterboxdPage({ onDone }: { onDone: () => void }) {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [username, setUsername] = useState("");
  const saveMutation = useSaveLetterboxdUsername();
  const [isSaved, setIsSaved] = useState(false);

  const trimmedUsername = username.trim();

  const handleSave = useCallback(() => {
    if (!trimmedUsername) return;
    saveMutation.mutate(trimmedUsername, {
      onSuccess: () => setIsSaved(true),
    });
  }, [saveMutation, trimmedUsername]);

  // Told once, never asked again — including by the feature tip that exists to
  // ask this very question.
  const handleNoLetterboxd = useCallback(() => {
    dismissTipForever("letterboxd-username");
    dismissTipForever("letterboxd-avatar");
    onDone();
  }, [onDone]);

  if (isSaved) return <AvatarQuestion onDone={onDone} />;

  // Render/output using the state and handlers prepared above.
  return (
    <IntroPageShell
      icon="bookmark-added"
      title="Connect your Letterboxd"
      message="Filter showtimes down to your watchlist, or hide films you have already seen."
      primaryLabel="Save and continue"
      onPrimary={handleSave}
      isPrimaryDisabled={!trimmedUsername}
      isPrimaryBusy={saveMutation.isPending}
      secondaryLabel="I don't use Letterboxd"
      onSecondary={handleNoLetterboxd}
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

      <View style={styles.helpPanel}>
        <ThemedText style={styles.helpTitle}>Where do I find my username?</ThemedText>
        <View style={styles.helpItem}>
          <ThemedText style={styles.helpItemTitle}>On the website</ThemedText>
          <ThemedText style={styles.helpItemText}>
            Open your profile and read the address bar. In letterboxd.com/yourname, your username is
            the part after the slash.
          </ThemedText>
        </View>
        <View style={styles.helpItem}>
          <ThemedText style={styles.helpItemTitle}>In the Letterboxd app</ThemedText>
          <ThemedText style={styles.helpItemText}>
            Open your profile and tap the three dots in the top right corner. Your username is the
            grayed out name.
          </ThemedText>
        </View>
      </View>
    </IntroPageShell>
  );
}

/** The picture question, as the page's second step. */
function AvatarQuestion({ onDone }: { onDone: () => void }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const currentUser = useCurrentUser();
  const avatarPreference = useLetterboxdAvatarPreference();

  // Set when saying yes brought no picture back: stays on this page to say
  // why the initial is still showing before moving on.
  const [isPictureMissing, setIsPictureMissing] = useState(false);

  const handleUse = useCallback(() => {
    avatarPreference
      .enable()
      .then((updated) => {
        if (updated.letterboxd_avatar_url) onDone();
        else setIsPictureMissing(true);
      })
      // The hook rolls the switch back; the intro still moves on.
      .catch(onDone);
  }, [avatarPreference, onDone]);

  if (isPictureMissing) {
    return (
      <IntroPageShell
        icon="account-circle"
        title="No picture found"
        message="Your coloured initial is used for now."
        primaryLabel="Continue"
        onPrimary={onDone}
      >
        {currentUser ? (
          <View style={styles.avatarPreview}>
            <PersonAvatar
              userId={currentUser.id}
              name={currentUser.display_name ?? ""}
              size={AVATAR_PREVIEW_SIZE}
              fontSize={40}
            />
            <View style={styles.missingNote}>
              <ThemedText style={styles.missingNoteText}>
                {`Either there is no Letterboxd account called "${currentUser.letterboxd_username ?? ""}", or it has no profile picture, so a default is used. If you create that account or add a picture later, your avatar updates by itself.`}
              </ThemedText>
              <ThemedText style={styles.missingNoteText}>
                You can change your Letterboxd username any time in Settings → Letterboxd.
              </ThemedText>
            </View>
          </View>
        ) : null}
      </IntroPageShell>
    );
  }

  return (
    <IntroPageShell
      icon="account-circle"
      title="Use your Letterboxd picture?"
      message={
        avatarPreference.pictureUrl
          ? "Show your Letterboxd profile picture to friends on MiKiNO instead of a coloured initial."
          : "Show your Letterboxd profile picture to friends on MiKiNO instead of a coloured initial. We'll fetch it from Letterboxd as soon as you say yes."
      }
      primaryLabel="Use my picture"
      onPrimary={handleUse}
      isPrimaryBusy={avatarPreference.isSaving}
      secondaryLabel="Not now"
      onSecondary={onDone}
    >
      {currentUser ? (
        <View style={styles.avatarPreview}>
          <PersonAvatar
            userId={currentUser.id}
            name={currentUser.display_name ?? ""}
            avatarUrl={avatarPreference.pictureUrl}
            size={AVATAR_PREVIEW_SIZE}
            fontSize={40}
          />
          <ThemedText style={styles.avatarNote}>
            You can change this any time in Settings → Letterboxd.
          </ThemedText>
        </View>
      ) : null}
    </IntroPageShell>
  );
}

const AVATAR_PREVIEW_SIZE = 112;

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
      backgroundColor: colors.cardBackground,
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
      gap: 16,
      marginTop: 24,
    },
    avatarNote: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      textAlign: "center",
    },
    missingNote: {
      gap: 8,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
    },
    missingNoteText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    helpPanel: {
      gap: 12,
      marginTop: 18,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
    },
    helpTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
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
