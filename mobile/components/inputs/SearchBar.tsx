/**
 * Mobile input component: Search Bar.
 *
 * Two shapes, one component. On its own it is a pill — the rounder it is, the
 * more it reads as something to tap rather than a grey slab. With the search
 * field selector (`onChangeSearchField`) it squares off to a soft rectangle
 * instead, because a dropdown attaches to its bottom edge and a pill cannot
 * line up with a list of rows.
 */
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Modal,
  StyleProp,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import type { SearchField } from "shared/client";

type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  searchField?: SearchField;
  onChangeSearchField?: (searchField: SearchField) => void;
  /**
   * Overrides the full-bleed chrome this carries by default (a screen's search
   * bar sits edge to edge under a header, and owns that inset itself). Pass a
   * transparent, unpadded style when the parent already has its own gutter, so
   * the box lines up with everything else instead of hanging 8pt wider on each
   * side.
   */
  containerStyle?: StyleProp<ViewStyle>;
};

const SEARCH_FIELD_OPTIONS: { id: SearchField; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "director", label: "Director" },
  { id: "actor", label: "Actor" },
  { id: "cinema", label: "Cinema" },
  { id: "friend", label: "Friends" },
];

const SEARCH_FIELD_PLACEHOLDER: Record<SearchField, string> = {
  title: "Search title",
  director: "Search director",
  actor: "Search actor",
  cinema: "Search cinema",
  friend: "Search friends",
};

const OPTION_HEIGHT = 46;
const DROPDOWN_CONTENT_HEIGHT = OPTION_HEIGHT * SEARCH_FIELD_OPTIONS.length;
const OPEN_DURATION_MS = 220;
const CLOSE_DURATION_MS = 170;
/** Corner radius of the standalone pill; half its height or more reads as round. */
const PILL_RADIUS = 26;
/** Corner radius when a dropdown has to attach flush to the bottom edge. */
const ATTACHED_RADIUS = 14;
/** Fixed slot for the clear button, reserved so the box never resizes as you type. */
const TRAILING_SLOT_WIDTH = 34;

export default function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
  searchField,
  onChangeSearchField,
  containerStyle,
}: SearchBarProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  // Theme-aware colors keep this input readable in both light and dark modes.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const boxRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  // Height captured from onLayout — measure() can briefly report 0 right after mount.
  const boxHeightRef = useRef<number>(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // Stays true until the closing animation finishes, so the Modal isn't ripped away mid-animation.
  const [renderDropdown, setRenderDropdown] = useState(false);
  const [dropdownLayout, setDropdownLayout] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const openProgress = useRef(new Animated.Value(0)).current;
  const caretRotation = useRef(new Animated.Value(0)).current;

  const showModeSelector = onChangeSearchField !== undefined;
  const activeSearchField = searchField ?? "title";
  const effectivePlaceholder = showModeSelector
    ? SEARCH_FIELD_PLACEHOLDER[activeSearchField]
    : placeholder;
  const restingRadius = showModeSelector ? ATTACHED_RADIUS : PILL_RADIUS;
  const hasValue = value.length > 0;

  useEffect(() => {
    Animated.timing(caretRotation, {
      toValue: isOpen ? 1 : 0,
      duration: isOpen ? OPEN_DURATION_MS : CLOSE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (isOpen) {
      Animated.timing(openProgress, {
        toValue: 1,
        duration: OPEN_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(openProgress, {
        toValue: 0,
        duration: CLOSE_DURATION_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setRenderDropdown(false);
      });
    }
  }, [isOpen, caretRotation, openProgress]);

  const caretSpin = caretRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const boxBottomRadius = openProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [restingRadius, 0],
  });

  const handleBoxLayout = (e: LayoutChangeEvent) => {
    boxHeightRef.current = e.nativeEvent.layout.height;
  };

  const handleToggleDropdown = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    boxRef.current?.measure(
      (_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) => {
        const boxHeight = height > 0 ? height : boxHeightRef.current;
        setDropdownLayout({ top: pageY + boxHeight, left: pageX, width });
        setRenderDropdown(true);
        setIsOpen(true);
      }
    );
  };

  const handleSelectSearchField = (optionId: SearchField) => {
    onChangeSearchField?.(optionId);
    setIsOpen(false);
  };

  const handleClear = () => {
    // Paints the emptied field on tap, before any search refetch it triggers.
    triggerSelectionHaptic();
    onChangeText("");
    inputRef.current?.focus();
  };

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.container, containerStyle]}>
      <View ref={boxRef} collapsable={false} onLayout={handleBoxLayout} style={styles.inputBoxWrap}>
        <Animated.View
          style={[
            styles.inputBox,
            {
              borderTopLeftRadius: restingRadius,
              borderTopRightRadius: restingRadius,
              borderBottomLeftRadius: boxBottomRadius,
              borderBottomRightRadius: boxBottomRadius,
            },
            // Only the colour changes on focus — a thicker border would nudge
            // everything inside the box by a pixel on every tap.
            isFocused && styles.inputBoxFocused,
          ]}
        >
          <MaterialIcons
            name="search"
            size={20}
            color={isFocused ? colors.tint : colors.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            ref={inputRef}
            style={styles.input}
            // Placeholder reflects the active search mode (title/director/actor/cinema/friends).
            placeholder={effectivePlaceholder}
            placeholderTextColor={colors.textSecondary}
            value={value}
            onChangeText={onChangeText}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            selectionColor={colors.tint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {/* Always occupies its slot so the field does not resize when the
              first character is typed. */}
          <View style={styles.trailingSlot}>
            {hasValue ? (
              <TouchableOpacity
                onPress={handleClear}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <MaterialIcons name="cancel" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {showModeSelector ? (
            <TouchableOpacity
              style={styles.caretButton}
              onPress={handleToggleDropdown}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Animated.View style={{ transform: [{ rotate: caretSpin }] }}>
                <MaterialIcons name="expand-more" size={20} color={colors.textSecondary} />
              </Animated.View>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </View>

      {renderDropdown && dropdownLayout && (
        <Modal
          transparent
          visible
          statusBarTranslucent
          animationType="none"
          onRequestClose={() => setIsOpen(false)}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setIsOpen(false)}
          />
          <Animated.View
            style={[
              styles.dropdown,
              {
                top: dropdownLayout.top,
                left: dropdownLayout.left,
                width: dropdownLayout.width,
                height: openProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, DROPDOWN_CONTENT_HEIGHT],
                }),
                opacity: openProgress,
              },
            ]}
          >
            {SEARCH_FIELD_OPTIONS.map((option, index) => {
              const isActive = option.id === activeSearchField;
              const isFirst = index === 0;
              const isLast = index === SEARCH_FIELD_OPTIONS.length - 1;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.optionRow,
                    isFirst && styles.optionRowFirst,
                    isLast && styles.optionRowLast,
                    isActive && styles.optionRowActive,
                  ]}
                  onPress={() => handleSelectSearchField(option.id)}
                  activeOpacity={0.8}
                >
                  <ThemedText
                    style={[styles.optionLabel, isActive && styles.optionLabelActive]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </ThemedText>
                  {isActive && (
                    <MaterialIcons name="check" size={16} color={colors.pillActiveText} />
                  )}
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        </Modal>
      )}
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.background,
    },
    inputBoxWrap: {},
    inputBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.searchBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    inputBoxFocused: {
      borderColor: colors.tint,
    },
    searchIcon: {
      marginLeft: 14,
    },
    input: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    trailingSlot: {
      width: TRAILING_SLOT_WIDTH,
      alignItems: "center",
      justifyContent: "center",
    },
    caretButton: {
      paddingRight: 12,
      paddingVertical: 12,
    },
    dropdown: {
      position: "absolute",
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderBottomLeftRadius: ATTACHED_RADIUS,
      borderBottomRightRadius: ATTACHED_RADIUS,
      backgroundColor: colors.searchBackground,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 10,
      overflow: "hidden",
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: OPTION_HEIGHT,
      paddingHorizontal: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    optionRowFirst: {
      borderTopWidth: 0,
    },
    optionRowLast: {
      borderBottomLeftRadius: ATTACHED_RADIUS,
      borderBottomRightRadius: ATTACHED_RADIUS,
    },
    optionRowActive: {
      backgroundColor: colors.pillActiveBackground,
    },
    optionLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.pillText,
    },
    optionLabelActive: {
      color: colors.pillActiveText,
      fontWeight: "700",
    },
  });
