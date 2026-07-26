/**
 * The shell every feature tip renders inside: a blocking dialog with an icon,
 * a title, an explanation, an optional inline control, an optional collapsible
 * help section, the button that performs the suggested action, and a
 * "Don't show this again" toggle.
 *
 * The toggle is read when the dialog closes, whichever way it closes, so the
 * user can set it and then leave by any route. Purely presentational: which tip
 * is on screen and what dismissing means is decided by `FeatureTipsHost` and
 * `utils/feature-tips`.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { type FeatureTipId, trackTipReaction } from "@/utils/feature-tips";
import { triggerSelectionHaptic } from "@/utils/long-press";

const FADE_IN_MS = 160;
const FADE_OUT_MS = 130;

/**
 * Horizontal padding around a compact tip's content. Exported so a child that
 * wants to run full width can cancel it out with a negative margin.
 */
export const FEATURE_TIP_COMPACT_PADDING = 18;

type FeatureTipModalProps = {
  /** Which tip this is, for the shown/reacted analytics events. */
  tipId: FeatureTipId;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  /** Omit when the title says it all and a subtitle would only pad the dialog. */
  message?: string;
  /**
   * "compact" shrinks the icon, title and spacing, for a tip whose own content
   * needs the room more than the header does.
   */
  density?: "default" | "compact";
  /** Inline control shown between the message and the buttons. */
  children?: ReactNode;
  /** Label for the collapsible help section. Omit to leave help out. */
  helpLabel?: string;
  helpContent?: ReactNode;
  actionLabel: string;
  /** Omit when `closeOnAction` is set and the button only dismisses the tip. */
  onAction?: () => void;
  isActionDisabled?: boolean;
  isActionBusy?: boolean;
  /** True when the action finishes the tip, so pressing it also closes. */
  closeOnAction?: boolean;
  /**
   * Hides the "Don't show this again" toggle. Set when the tip was opened as
   * on-demand help (e.g. an info icon) rather than a proactive suggestion —
   * there is no future nag to opt out of.
   */
  hideDismissForever?: boolean;
  /** Receives the state of the "Don't show this again" toggle. */
  onDismiss: (dismissForever: boolean) => void;
};

export default function FeatureTipModal({
  tipId,
  icon,
  title,
  message,
  density = "default",
  children,
  helpLabel,
  helpContent,
  actionLabel,
  onAction,
  isActionDisabled = false,
  isActionBusy = false,
  closeOnAction = false,
  hideDismissForever = false,
  onDismiss,
}: FeatureTipModalProps) {
  // Read flow: local state first, then the handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const isCompact = density === "compact";
  const anim = useRef(new Animated.Value(0)).current;
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [shouldNeverShowAgain, setShouldNeverShowAgain] = useState(false);
  // Blocks a second close while the dialog is fading out.
  const [isClosing, setIsClosing] = useState(false);
  // The dialog takes itself off screen rather than waiting to be unmounted:
  // the host keeps a forced tip (see FORCED_TIP_ID) mounted forever, and a
  // faded-out Modal still swallows every touch on the screen behind it.
  const [isDismissed, setIsDismissed] = useState(false);
  // Once the user has pressed the primary action, that is the reaction worth
  // recording — the close that follows (including `closeOnAction`'s own call)
  // is just the dialog tidying itself away, not a separate dismissal.
  const didInteract = useRef(false);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: FADE_IN_MS,
      useNativeDriver: true,
    }).start();
  }, [anim]);

  // The exit animation has to finish before the dialog leaves the tree, so the
  // store is only told once it has played out.
  const close = useCallback(() => {
    if (isClosing) return;
    triggerSelectionHaptic();
    setIsClosing(true);
    Animated.timing(anim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(() => {
      setIsDismissed(true);
      if (!didInteract.current) {
        trackTipReaction(tipId, shouldNeverShowAgain ? "dont_show_again" : "dismissed");
      }
      onDismiss(shouldNeverShowAgain);
    });
  }, [anim, isClosing, onDismiss, shouldNeverShowAgain, tipId]);

  const handleAction = useCallback(() => {
    if (onAction) {
      didInteract.current = true;
      trackTipReaction(tipId, "interacted");
    }
    if (closeOnAction) {
      // `close` fires the haptic itself, and runs `onDismiss` only once the
      // dialog is off screen — so an action that opens something else can hang
      // its work off the dismissal rather than racing the fade.
      onAction?.();
      close();
      return;
    }
    triggerSelectionHaptic();
    onAction?.();
  }, [close, closeOnAction, onAction, tipId]);

  const handleToggleHelp = useCallback(() => {
    triggerSelectionHaptic();
    setIsHelpOpen((previous) => !previous);
  }, []);

  const handleToggleNeverShowAgain = useCallback(() => {
    triggerSelectionHaptic();
    setShouldNeverShowAgain((previous) => !previous);
  }, []);

  // Render/output using the state and handlers prepared above.
  if (isDismissed) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />
        <KeyboardAvoidingView
          style={styles.keyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={close}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <MaterialIcons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>

            <ScrollView
              contentContainerStyle={[styles.content, isCompact && styles.contentCompact]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={[styles.iconBubble, isCompact && styles.iconBubbleCompact]}>
                <MaterialIcons name={icon} size={isCompact ? 24 : 30} color={colors.tint} />
              </View>
              <ThemedText style={[styles.title, isCompact && styles.titleCompact]}>
                {title}
              </ThemedText>
              {message ? <ThemedText style={styles.message}>{message}</ThemedText> : null}

              {children}

              {helpLabel && helpContent ? (
                <View style={styles.helpSection}>
                  <TouchableOpacity
                    style={styles.helpToggle}
                    onPress={handleToggleHelp}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isHelpOpen }}
                  >
                    <MaterialIcons name="help-outline" size={16} color={colors.tint} />
                    <ThemedText style={styles.helpToggleText}>{helpLabel}</ThemedText>
                    <MaterialIcons
                      name={isHelpOpen ? "expand-less" : "expand-more"}
                      size={18}
                      color={colors.tint}
                    />
                  </TouchableOpacity>
                  {isHelpOpen ? <View style={styles.helpPanel}>{helpContent}</View> : null}
                </View>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.actionButton,
                  (isActionDisabled || isActionBusy) && styles.actionButtonDisabled,
                ]}
                onPress={handleAction}
                disabled={isActionDisabled || isActionBusy}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                {isActionBusy ? (
                  <ActivityIndicator size="small" color={colors.pillActiveText} />
                ) : (
                  <ThemedText style={styles.actionText}>{actionLabel}</ThemedText>
                )}
              </TouchableOpacity>
            </ScrollView>

            {/* Deliberately quiet: always reachable, but never competing with
                the action above it. */}
            {hideDismissForever ? null : (
              <TouchableOpacity
                style={styles.neverRow}
                onPress={handleToggleNeverShowAgain}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: shouldNeverShowAgain }}
              >
                <MaterialIcons
                  name={shouldNeverShowAgain ? "check-box" : "check-box-outline-blank"}
                  size={15}
                  color={shouldNeverShowAgain ? colors.tint : colors.textSecondary}
                />
                <ThemedText
                  style={[styles.neverLabel, shouldNeverShowAgain && styles.neverLabelActive]}
                >
                  Don&apos;t show this again
                </ThemedText>
              </TouchableOpacity>
            )}
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
      backgroundColor: "rgba(0, 0, 0, 0.45)",
      justifyContent: "center",
    },
    keyboardAvoider: {
      // Fills the backdrop so it can recentre the card in whatever space the
      // keyboard leaves behind.
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 20,
    },
    card: {
      width: "100%",
      maxWidth: 440,
      maxHeight: "88%",
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    closeButton: {
      position: "absolute",
      top: 12,
      right: 12,
      zIndex: 1,
      padding: 4,
    },
    content: {
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 14,
      gap: 14,
      alignItems: "stretch",
    },
    contentCompact: {
      paddingHorizontal: FEATURE_TIP_COMPACT_PADDING,
      paddingTop: 18,
      paddingBottom: 10,
      gap: 10,
    },
    iconBubble: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignSelf: "center",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
      marginBottom: 2,
    },
    iconBubbleCompact: {
      width: 44,
      height: 44,
      borderRadius: 22,
      marginBottom: 0,
    },
    title: {
      fontSize: 21,
      lineHeight: 27,
      fontWeight: "700",
      textAlign: "center",
      color: colors.text,
    },
    titleCompact: {
      fontSize: 18,
      lineHeight: 23,
    },
    message: {
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
      color: colors.textSecondary,
    },
    helpSection: {
      gap: 10,
    },
    helpToggle: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "center",
      gap: 6,
      paddingVertical: 4,
    },
    helpToggleText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.tint,
    },
    helpPanel: {
      gap: 12,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    actionButton: {
      minHeight: 50,
      marginTop: 4,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    actionButtonDisabled: {
      opacity: 0.5,
    },
    actionText: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    neverRow: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingTop: 2,
      paddingBottom: 14,
    },
    neverLabel: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    neverLabelActive: {
      color: colors.text,
    },
  });
