/**
 * Themed in-app "type a name" dialog — the input-bearing sibling of
 * `ConfirmDialog`, for the moment a flow needs one short string and nothing
 * else. Same fade/scale timing, so the two read as one family.
 *
 * The value lives here: callers get the trimmed name on confirm and never have
 * to hold draft text of their own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

const FADE_IN_MS = 140;
const FADE_OUT_MS = 120;
const DEFAULT_MAX_LENGTH = 80;

type NamePromptDialogProps = {
  visible: boolean;
  title: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel?: string;
  maxLength?: number;
  /** Keeps the dialog up with a spinner while the caller saves. */
  isBusy?: boolean;
  /** Receives the trimmed name; only called when it is non-empty. */
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

export default function NamePromptDialog({
  visible,
  title,
  placeholder,
  confirmLabel,
  cancelLabel = "Cancel",
  maxLength = DEFAULT_MAX_LENGTH,
  isBusy = false,
  onConfirm,
  onCancel,
}: NamePromptDialogProps) {
  // Read flow: state setup first, then the handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Kept mounted one beat longer than `visible` so the closing fade can play out.
  const [isMounted, setIsMounted] = useState(visible);
  const [name, setName] = useState("");
  const anim = useRef(new Animated.Value(0)).current;
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      setName("");
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: FADE_IN_MS,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(() => setIsMounted(false));
  }, [visible, anim]);

  const trimmedName = name.trim();
  const canConfirm = trimmedName.length > 0 && !isBusy;

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    triggerSelectionHaptic();
    onConfirm(trimmedName);
  }, [canConfirm, onConfirm, trimmedName]);

  const handleCancel = useCallback(() => {
    if (isBusy) return;
    onCancel();
  }, [isBusy, onCancel]);

  // Render/output using the state and handlers prepared above.
  if (!isMounted) return null;

  return (
    <Modal
      transparent
      statusBarTranslucent
      visible
      animationType="none"
      onRequestClose={handleCancel}
    >
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleCancel}
        />
        <KeyboardAvoidingView
          style={styles.keyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
            <ThemedText style={styles.title}>{title}</ThemedText>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={placeholder}
              placeholderTextColor={colors.textSecondary}
              maxLength={maxLength}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleConfirm}
              editable={!isBusy}
            />
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleCancel}
                disabled={isBusy}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <ThemedText style={styles.cancelText}>{cancelLabel}</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.confirmButton, !canConfirm && styles.buttonDisabled]}
                onPress={handleConfirm}
                disabled={!canConfirm}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color={colors.pillActiveText} />
                ) : (
                  <ThemedText style={styles.confirmText}>{confirmLabel}</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.28)",
      justifyContent: "center",
    },
    keyboardAvoider: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    card: {
      width: "100%",
      maxWidth: 340,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 14,
      gap: 12,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    input: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 11,
      backgroundColor: colors.background,
      color: colors.text,
      fontSize: 16,
    },
    actions: { flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: 2 },
    button: {
      flex: 1,
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: { opacity: 0.5 },
    cancelButton: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    cancelText: { fontSize: 14, fontWeight: "700", color: colors.text },
    confirmButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    confirmText: { fontSize: 14, fontWeight: "700", color: colors.pillActiveText },
  });
