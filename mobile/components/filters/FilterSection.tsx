/**
 * The two shapes a section of the Filters modal can take, kept in one file so
 * they share their heading metrics and line up down the sheet.
 *
 * `FilterSection` is the collapsible one, closed by default: the modal has
 * grown long enough that scrolling past sections you never touch costs more
 * than one tap to open the one you want. The caret spins on the native thread
 * so it responds on touch even while the (sometimes heavy) section content
 * mounts. Children are unmounted while collapsed, so opening the modal only
 * pays for the sections the user actually opens — anything a section must
 * remember has to live in the caller's state, not inside the section.
 *
 * `FilterInlineRow` is for a section whose entire content is one control:
 * hiding a single segmented control behind a caret costs a tap and saves no
 * space, so the label and the control share one line instead.
 */
import { PropsWithChildren, useCallback, useMemo, useRef, useState } from "react";
import { Animated, LayoutAnimation, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { EXPAND_DURATION_MS, EXPAND_LAYOUT_ANIMATION } from "@/utils/expand-animation";
import { triggerSelectionHaptic } from "@/utils/long-press";

type Props = PropsWithChildren<{
  label: string;
  /** Start expanded — for a section that is the point of the screen it's on. */
  defaultOpen?: boolean;
  /**
   * What the section currently filters on, shown in the header while collapsed
   * so a closed section still says what it is doing.
   */
  summary?: string;
}>;

export default function FilterSection({ label, defaultOpen = false, summary, children }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Caret rotation: 0 = collapsed (0°), 1 = expanded (180°).
  const caretRotation = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;
  const caretSpin = useMemo(
    () => caretRotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }),
    [caretRotation]
  );

  const toggle = useCallback(() => {
    triggerSelectionHaptic();
    const next = !isOpen;
    Animated.timing(caretRotation, {
      toValue: next ? 1 : 0,
      duration: EXPAND_DURATION_MS,
      useNativeDriver: true,
    }).start();
    // Only the collapse gets the height tween. Expanding mounts the section's
    // content in the same frame, and animating that mount janks the tween — the
    // caret spin already carries the interaction (same trade-off as the
    // invite-friends toggle in ShowtimeActionModal).
    if (!next) LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
    setIsOpen(next);
  }, [isOpen, caretRotation]);

  return (
    <View>
      <TouchableOpacity
        style={styles.header}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
      >
        <ThemedText style={styles.label}>{label}</ThemedText>
        <View style={styles.headerRight}>
          {summary !== undefined && !isOpen && (
            <ThemedText style={styles.summary} numberOfLines={1}>
              {summary}
            </ThemedText>
          )}
          <Animated.View style={{ transform: [{ rotate: caretSpin }] }}>
            <MaterialIcons name="expand-more" size={20} color={colors.textSecondary} />
          </Animated.View>
        </View>
      </TouchableOpacity>
      {isOpen && <View style={styles.content}>{children}</View>}
    </View>
  );
}

/**
 * A header-styled row that isn't collapsible: tapping it navigates elsewhere
 * (e.g. opens a picker modal) instead of expanding content in place. Shares
 * `FilterSection`'s label/summary metrics so sections line up, but the caret
 * points right rather than down since there is nothing to expand here.
 */
export function FilterNavRow({
  label,
  summary,
  onPress,
}: {
  label: string;
  summary?: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <TouchableOpacity
      style={styles.header}
      onPress={() => {
        triggerSelectionHaptic();
        onPress();
      }}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <ThemedText style={styles.label}>{label}</ThemedText>
      <View style={styles.headerRight}>
        {summary !== undefined && (
          <ThemedText style={styles.summary} numberOfLines={1}>
            {summary}
          </ThemedText>
        )}
        <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

/**
 * A section that is a single control: label on the left, control on the right,
 * always on one line. The controls are sized to leave room for their labels;
 * `adjustsFontSizeToFit` is the backstop for the narrowest phones, where a
 * label shrinking a point is better than wrapping or being cut off.
 */
export function FilterInlineRow({ label, children }: PropsWithChildren<{ label: string }>) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.inlineRow}>
      <ThemedText
        style={[styles.label, styles.inlineLabel]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

/**
 * Heading for a block *inside* a section ("Movie Length", "Curated lists"),
 * one step down from the section's own uppercase label.
 */
export function FilterSubLabel({ label, isFirst }: { label: string; isFirst?: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ThemedText style={[styles.subLabel, isFirst && styles.subLabelFirst]}>{label}</ThemedText>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      // Vertical padding keeps the tap target comfortable without pushing the
      // label away from its content when expanded.
      paddingVertical: 6,
    },
    label: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
    summary: { fontSize: 12, fontWeight: "600", color: colors.text, flexShrink: 1 },
    content: { marginTop: 7 },
    inlineRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingVertical: 5,
    },
    inlineLabel: { flexShrink: 1 },
    subLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
      marginTop: 14,
      marginBottom: 8,
    },
    // The first block in a section already has the section heading above it.
    subLabelFirst: { marginTop: 0 },
  });
