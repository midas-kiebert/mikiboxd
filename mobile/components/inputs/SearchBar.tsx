/**
 * Mobile input component: Search Bar.
 *
 * Two shapes, one component. On its own it is a pill — the rounder it is, the
 * more it reads as something to tap rather than a grey slab. With the search
 * field selector (`onChangeSearchField`) it squares off to a soft rectangle
 * instead, because a dropdown attaches to its bottom edge and a pill cannot
 * line up with a list of rows.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Modal,
  Platform,
  StyleProp,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useIsFocused } from "@react-navigation/native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { useAndroidBackHandler } from "@/utils/android-back";
import { useIsSignedIn } from "@/utils/auth-session";
import type { SearchField } from "shared/client";

type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  searchField?: SearchField;
  onChangeSearchField?: (searchField: SearchField) => void;
  /**
   * Search fields to leave out of the dropdown, for screens where one of them
   * has no meaning — the cinema page is already a single cinema, so searching
   * by cinema there could only ever return the same list or nothing.
   */
  hiddenSearchFields?: readonly SearchField[];
  /**
   * Overrides the full-bleed chrome this carries by default (a screen's search
   * bar sits edge to edge under a header, and owns that inset itself). Pass a
   * transparent, unpadded style when the parent already has its own gutter, so
   * the box lines up with everything else instead of hanging 8pt wider on each
   * side.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Rendered to the left of the search field, in the same row and stretched to
   * its height (the Filters button on the feeds that have one).
   */
  leftSlot?: ReactNode;
  /**
   * Android hardware back empties the field instead of leaving the screen,
   * while there is anything in it. Opt-in, and only correct for a search bar
   * that belongs to a navigator screen — see {@link AndroidBackClear}. The
   * copies rendered inside overlays (the intro's friends page, the add-friends
   * tip) leave it off: back there belongs to the overlay.
   */
  clearOnAndroidBack?: boolean;
};

/**
 * Turns Android's back press into "clear the search" for as long as the search
 * bar owns the screen.
 *
 * Rendered (and therefore subscribed) only while the field has something in it
 * and its screen is focused. Both halves matter: an empty bar must not sit
 * between the user and back, and a tab's search bar stays mounted while a
 * detail screen is pushed over it — without the focus check, a query left on
 * the showtimes tab would silently eat back on the movie page.
 */
function AndroidBackClear({ onClear }: { onClear: () => void }) {
  const isFocused = useIsFocused();

  // Shared stack, so a sheet opened over the screen still wins the press even
  // though this subscribed first — see `utils/android-back.ts`.
  useAndroidBackHandler(isFocused, () => {
    onClear();
    // Handled: the press is spent on the field, and the next one — with
    // nothing left to clear — navigates as usual.
    return true;
  });

  return null;
}

const SEARCH_FIELD_OPTIONS: {
  id: SearchField;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}[] = [
  { id: "title", label: "Title", icon: "movie" },
  // A camera for the person behind it, drama masks for the ones in front:
  // three of these five options are film-related, so they need distinct
  // silhouettes rather than three variations of a film reel. Not
  // `movie-creation` — Material draws that as the same clapperboard as
  // `movie`, despite the separate codepoint.
  { id: "director", label: "Director", icon: "videocam" },
  { id: "actor", label: "Actor", icon: "theater-comedy" },
  // The pin `TopBar` already uses for a cinema's location, rather than another
  // film-adjacent glyph: this option searches for a venue, not for a film.
  { id: "cinema", label: "Cinema", icon: "place" },
  { id: "friend", label: "Friends", icon: "group" },
];

/** The dropdown's own wording for a field, reused wherever one is named. */
export const getSearchFieldLabel = (field: SearchField): string =>
  SEARCH_FIELD_OPTIONS.find((option) => option.id === field)?.label ?? field;

const SEARCH_FIELD_PLACEHOLDER: Record<SearchField, string> = {
  title: "Search title",
  director: "Search director",
  actor: "Search actor",
  cinema: "Search cinema",
  friend: "Search friends",
};

const OPTION_HEIGHT = 46;
const OPTION_ICON_SIZE = 18;
/** Searching by friend needs friends, which needs an account. */
const ACCOUNT_ONLY_SEARCH_FIELDS: ReadonlySet<SearchField> = new Set(["friend"]);
/** Stable default for `hiddenSearchFields`, so the options memo isn't rebuilt every render. */
const NO_HIDDEN_SEARCH_FIELDS: readonly SearchField[] = [];
const OPEN_DURATION_MS = 220;
const CLOSE_DURATION_MS = 170;
/**
 * Corner radius of the standalone pill; half its height or more reads as round.
 * Exported so anything sharing the row (the Filters button in `leftSlot`) can
 * be cut to the same shape.
 */
export const SEARCH_FIELD_RADIUS = 26;

/** The field's own type size, shared with whatever sits beside it. */
export const SEARCH_FIELD_FONT_SIZE = 16;
/**
 * Corner radius when a dropdown has to attach flush to the bottom edge — which
 * is what the field rests at on every screen carrying the mode selector.
 * Exported for the same reason as {@link SEARCH_FIELD_RADIUS}.
 */
export const SEARCH_FIELD_ATTACHED_RADIUS = 14;
/** Fixed slot for the clear button, reserved so the box never resizes as you type. */
const TRAILING_SLOT_WIDTH = 34;

export default function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
  searchField,
  onChangeSearchField,
  hiddenSearchFields = NO_HIDDEN_SEARCH_FIELDS,
  containerStyle,
  clearOnAndroidBack = false,
  leftSlot,
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

  const isSignedIn = useIsSignedIn();
  const searchFieldOptions = useMemo(
    () =>
      SEARCH_FIELD_OPTIONS.filter(
        (option) =>
          !hiddenSearchFields.includes(option.id) &&
          (isSignedIn || !ACCOUNT_ONLY_SEARCH_FIELDS.has(option.id))
      ),
    [hiddenSearchFields, isSignedIn]
  );
  const dropdownContentHeight = OPTION_HEIGHT * searchFieldOptions.length;

  const showModeSelector = onChangeSearchField !== undefined;
  const activeSearchField = searchField ?? "title";
  const effectivePlaceholder = showModeSelector
    ? SEARCH_FIELD_PLACEHOLDER[activeSearchField]
    : placeholder;
  const restingRadius = showModeSelector ? SEARCH_FIELD_ATTACHED_RADIUS : SEARCH_FIELD_RADIUS;
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
    // Fired before the measure() round trip below, so the tap is felt the
    // instant it lands rather than one frame later with the dropdown.
    triggerSelectionHaptic();
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
    // Ahead of the mode change, which refetches the search on the screen below.
    triggerSelectionHaptic();
    onChangeSearchField?.(optionId);
    setIsOpen(false);
  };

  const handleClear = () => {
    // Paints the emptied field on tap, before any search refetch it triggers.
    triggerSelectionHaptic();
    onChangeText("");
    inputRef.current?.focus();
  };

  // Same clear, minus the focus grab: someone pressing back is on their way out
  // of the search, so pulling the keyboard back up would be the opposite of
  // what they asked for.
  const handleClearFromBack = useCallback(() => {
    onChangeText("");
  }, [onChangeText]);

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.container, containerStyle]}>
      {clearOnAndroidBack && hasValue && Platform.OS === "android" ? (
        <AndroidBackClear onClear={handleClearFromBack} />
      ) : null}
      <View style={styles.searchRow}>
        {leftSlot}
        <View
          ref={boxRef}
          collapsable={false}
          onLayout={handleBoxLayout}
          style={styles.inputBoxWrap}
        >
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
                  outputRange: [0, dropdownContentHeight],
                }),
                opacity: openProgress,
              },
            ]}
          >
            {searchFieldOptions.map((option, index) => {
              const isActive = option.id === activeSearchField;
              const isFirst = index === 0;
              const isLast = index === searchFieldOptions.length - 1;
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
                  <View style={styles.optionMain}>
                    <MaterialIcons
                      name={option.icon}
                      size={OPTION_ICON_SIZE}
                      color={isActive ? colors.pillActiveText : colors.pillText}
                    />
                    <ThemedText
                      style={[styles.optionLabel, isActive && styles.optionLabelActive]}
                      numberOfLines={1}
                    >
                      {option.label}
                    </ThemedText>
                  </View>
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
    searchRow: {
      flexDirection: "row",
      // Stretch, so anything in `rightSlot` comes out exactly as tall as the
      // search field without either side hardcoding a height.
      alignItems: "stretch",
      gap: 10,
    },
    inputBoxWrap: { flex: 1 },
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
      fontSize: SEARCH_FIELD_FONT_SIZE,
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
      borderBottomLeftRadius: SEARCH_FIELD_ATTACHED_RADIUS,
      borderBottomRightRadius: SEARCH_FIELD_ATTACHED_RADIUS,
      backgroundColor: colors.searchBackground,
      // Continues the field's own outline down the list. No top edge: the
      // dropdown is positioned flush under the box, whose bottom border already
      // draws the seam between them.
      borderWidth: 1,
      borderTopWidth: 0,
      borderColor: colors.cardBorder,
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
      borderBottomLeftRadius: SEARCH_FIELD_ATTACHED_RADIUS,
      borderBottomRightRadius: SEARCH_FIELD_ATTACHED_RADIUS,
    },
    optionRowActive: {
      backgroundColor: colors.pillActiveBackground,
    },
    optionMain: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      // Lets a long label truncate instead of pushing the check mark out.
      flexShrink: 1,
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
