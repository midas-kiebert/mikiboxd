/**
 * One labelled input on an auth screen.
 *
 * The focus ring recolours a border that is always there, so focusing a field
 * cannot reflow the form — the usual "grow the border on focus" trick moves
 * every field below it by a pixel on every tap. Validation messages are tweened
 * in for the same reason (see `useLayoutAnimatedValue`).
 */
import { forwardRef, useState } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useLayoutAnimatedValue } from "@/hooks/useLayoutAnimatedValue";

type AuthTextFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  /** Validation failure for this field; replaces the hint while it is set. */
  error?: string;
  /** Standing guidance ("4-15 characters..."), shown when there is no error. */
  hint?: string;
  /** Read as one unit with what is typed, e.g. "letterboxd.com/". */
  prefix?: string;
};

const AuthTextField = forwardRef<TextInput, AuthTextFieldProps>(function AuthTextField(
  { label, error, hint, prefix, secureTextEntry, onFocus, onBlur, ...inputProps },
  ref
) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [isFocused, setIsFocused] = useState(false);
  const [isSecureHidden, setIsSecureHidden] = useState(true);

  const message = useLayoutAnimatedValue(error ?? hint ?? null);
  const isErrorMessage = Boolean(error);

  return (
    <View style={styles.container}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <View
        style={[
          styles.inputRow,
          isFocused && styles.inputRowFocused,
          Boolean(error) && styles.inputRowError,
        ]}
      >
        {prefix ? <ThemedText style={styles.prefix}>{prefix}</ThemedText> : null}
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.tint}
          secureTextEntry={secureTextEntry ? isSecureHidden : false}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          {...inputProps}
        />
        {secureTextEntry ? (
          <TouchableOpacity
            style={styles.revealButton}
            onPress={() => setIsSecureHidden((hidden) => !hidden)}
            hitSlop={8}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={isSecureHidden ? "Show password" : "Hide password"}
          >
            <MaterialIcons
              name={isSecureHidden ? "visibility-off" : "visibility"}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {message ? (
        <ThemedText style={[styles.message, isErrorMessage && styles.messageError]}>
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
});

export default AuthTextField;

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      gap: 4,
    },
    label: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: colors.textSecondary,
      paddingLeft: 2,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
      paddingLeft: 14,
      paddingRight: 6,
    },
    // Border width never changes, only its colour — so focus cannot reflow.
    inputRowFocused: {
      borderColor: colors.tint,
    },
    inputRowError: {
      borderColor: colors.red.secondary,
    },
    prefix: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    input: {
      flex: 1,
      // Android gives TextInput horizontal padding of its own, which would
      // detach it from any prefix sitting directly to its left.
      paddingLeft: 0,
      paddingRight: 8,
      paddingVertical: 11,
      fontSize: 16,
      color: colors.text,
    },
    revealButton: {
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    message: {
      fontSize: 12,
      lineHeight: 15,
      color: colors.textSecondary,
      paddingLeft: 2,
    },
    messageError: {
      color: colors.red.secondary,
      fontWeight: "600",
    },
  });
