/**
 * Mobile input component: Search Bar.
 */
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import type { SearchField } from "shared/client";

type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  searchField?: SearchField;
  onChangeSearchField?: (searchField: SearchField) => void;
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

export default function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
  searchField,
  onChangeSearchField,
}: SearchBarProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  // Theme-aware colors keep this input readable in both light and dark modes.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const boxRef = useRef<View>(null);
  // Height captured from onLayout — measure() can briefly report 0 right after mount.
  const boxHeightRef = useRef<number>(0);
  const [isOpen, setIsOpen] = useState(false);
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
    outputRange: [12, 0],
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

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      <View ref={boxRef} collapsable={false} onLayout={handleBoxLayout} style={styles.inputBoxWrap}>
        <Animated.View
          style={[
            styles.inputBox,
            { borderBottomLeftRadius: boxBottomRadius, borderBottomRightRadius: boxBottomRadius },
          ]}
        >
          <TextInput
            style={[styles.input, showModeSelector && styles.inputWithCaret]}
            // Placeholder reflects the active search mode (title/director/actor/cinema/friends).
            placeholder={effectivePlaceholder}
            placeholderTextColor={colors.textSecondary}
            value={value}
            onChangeText={onChangeText}
          />
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
      borderRadius: 12,
    },
    input: {
      flex: 1,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    inputWithCaret: {
      paddingRight: 4,
    },
    caretButton: {
      paddingHorizontal: 10,
      paddingVertical: 12,
    },
    dropdown: {
      position: "absolute",
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderBottomLeftRadius: 12,
      borderBottomRightRadius: 12,
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
      borderBottomLeftRadius: 12,
      borderBottomRightRadius: 12,
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
