/**
 * Feature tip: save your Cineville pass number, so its barcode is one tap away
 * at the cinema door. Low priority — a convenience for pass holders only.
 *
 * Says plainly what it is not: MiKiNO is not connected to Cineville in any
 * way, and the number never leaves the phone (see `utils/cineville-card`).
 * Takes the number inline, like the Letterboxd tip, rather than sending the
 * user to Settings for one field.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and saves.
 */
import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  CINEVILLE_DIGITS_LENGTH,
  CINEVILLE_PREFIX,
  saveCinevilleCardDigits,
} from "@/utils/cineville-card";
import { useDismissTip } from "@/utils/feature-tips";

const DIGITS_PATTERN = new RegExp(`^\\d{${CINEVILLE_DIGITS_LENGTH}}$`);

export default function CinevillePassTip() {
  // Read flow: local state first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("cineville-pass");
  const [digits, setDigits] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const trimmed = digits.trim();
  const isValid = DIGITS_PATTERN.test(trimmed);

  const handleSave = useCallback(async () => {
    if (!isValid) return;
    setIsSaving(true);
    try {
      await saveCinevilleCardDigits(trimmed);
      setIsSaved(true);
    } catch (error) {
      console.error("Error saving the Cineville card:", error);
    } finally {
      setIsSaving(false);
    }
  }, [isValid, trimmed]);

  // Render/output using the state and handlers prepared above.
  if (isSaved) {
    return (
      <FeatureTipModal
        tipId="cineville-pass"
        icon="check-circle"
        title="Cineville pass saved"
        message="Tap the barcode button on the Showtimes and Activity screens to show it at the cinema. You can change or remove it in Settings."
        actionLabel="Done"
        closeOnAction
        onDismiss={dismissTip}
      />
    );
  }

  return (
    <FeatureTipModal
      tipId="cineville-pass"
      icon="badge"
      title="Got a Cineville pass?"
      message="Save your pass number and MiKiNO will copy it to your clipboard when you go to buy a ticket. You can also open the barcode from within MiKiNO."
      actionLabel="Save my pass"
      onAction={() => void handleSave()}
      isActionDisabled={!isValid}
      isActionBusy={isSaving}
      onDismiss={dismissTip}
      helpLabel="Is this connected to Cineville?"
      helpContent={
        <ThemedText style={styles.helpText}>
          No. It only draws the barcode from the
          number you type here. The number is stored on this phone only. It is never sent to
          MiKiNO or anyone else.
        </ThemedText>
      }
    >
      <View style={styles.field}>
        <ThemedText style={styles.fieldLabel}>Pass number</ThemedText>
        <View style={styles.inputRow}>
          <ThemedText style={styles.prefix}>{CINEVILLE_PREFIX}</ThemedText>
          <TextInput
            style={styles.input}
            value={digits}
            onChangeText={setDigits}
            placeholder={"0".repeat(CINEVILLE_DIGITS_LENGTH)}
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            maxLength={CINEVILLE_DIGITS_LENGTH}
            returnKeyType="done"
            onSubmitEditing={() => void handleSave()}
            editable={!isSaving}
          />
        </View>
        <ThemedText style={styles.fieldNote}>
          Stored on this phone only. Not connected to Cineville.
        </ThemedText>
      </View>
    </FeatureTipModal>
  );
}

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
      fontSize: 16,
      color: colors.textSecondary,
    },
    input: {
      flex: 1,
      paddingLeft: 0,
      paddingRight: 12,
      paddingVertical: 13,
      fontSize: 16,
      color: colors.text,
    },
    fieldNote: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    helpText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
  });
