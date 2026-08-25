/**
 * Full-screen visual seat picker for cinemas whose room we have a floor plan
 * for (currently Filmhallen, The Movies, Kino, Filmkoepel, Louis Hartlooper,
 * Slachtstraat and Springhaver — see `backend/scripts/ingest-seat-floor-plans.py`).
 *
 * Deliberately generic: it never receives a cinema identifier, only seat
 * geometry + status, so every room renders the same plain colored rectangles
 * regardless of which cinema it belongs to — a plain `Modal` (like the text
 * seat editor it replaces for these cinemas), not a bottom sheet, since a
 * pannable room needs more space than a partial-height sheet gives.
 *
 * This is purely a *picker*, not a booking flow: any seat can be tapped,
 * including one the live read says is taken — the common case is picking the
 * seat you already bought a ticket for elsewhere. Tapping a seat only fills
 * the row/seat fields below (or vice versa, typing them highlights the
 * matching seat); nothing saves until "Save" is pressed, so the parent's
 * existing draft state (`seatRowDraft`/`seatNumberDraft`) is the single
 * source of truth for both this screen and the plain-text fallback dialog.
 *
 * The footer (row/seat fields + Save/Cancel) is an absolutely-positioned
 * overlay, not a flex sibling of the seat grid above it — that's deliberate:
 * `KeyboardAvoidingView`/flex-based approaches here fought each other (Android
 * has `edgeToEdgeEnabled` on, which disables the window auto-resize those
 * normally lean on) and left the footer either behind the keyboard or, when
 * fixed, dragging the seat grid up into the header with it. The footer's own
 * `bottom` offset is instead an `Animated.Value` driven by the keyboard's
 * show/hide events (`keyboardWillShow`/`Hide` on iOS so the animation starts
 * in step with the real one — `keyboardDidShow`/`Hide` fire only once the
 * keyboard has already finished moving, which reads as a snap), decoupling
 * the footer completely from the grid: the grid's size is measured once (see
 * `bodySize`) and never changes for the keyboard, while the footer always
 * floats above it, in motion with it. While the keyboard is up, seats stop
 * being tappable and a tap anywhere in the grid area dismisses the keyboard
 * instead (via the wrapping `TouchableWithoutFeedback`) — the footer is
 * deliberately outside that wrapper so its own inputs/buttons behave normally.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SeatFloorPlanSeatPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import {
  getSeatFieldMaxLength,
  type SeatInputConfig,
} from "@/components/showtimes/seat-input";
import { layoutSeatFloorPlan, type ScaledSeat } from "@/components/showtimes/seat-floor-plan-layout";

type SeatFloorPlanProps = {
  visible: boolean;
  room: string | null;
  seats: SeatFloorPlanSeatPublic[] | null;
  isLoading: boolean;
  isError: boolean;
  cinemaName: string | null;
  movieTitle: string | null;
  dateLabel: string | null;
  timeRangeLabel: string | null;
  seatRowDraft: string;
  seatNumberDraft: string;
  onChangeSeatRowDraft: (value: string) => void;
  onChangeSeatNumberDraft: (value: string) => void;
  seatInputConfig: SeatInputConfig;
  seatValidationError: string | null;
  canSave: boolean;
  isSaving: boolean;
  onSelectSeat: (rowName: string, seatName: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

const HEADER_TOP_PADDING = 8;
const LEGEND_HEIGHT = 34;
const FOOTER_HEIGHT = 150;
// Only used as a fallback when a keyboard event doesn't carry its own
// duration (observed on some Android versions) — iOS always reports one.
const DEFAULT_KEYBOARD_ANIMATION_MS = 250;

// iOS's keyboard events report curve names, not literal easing functions;
// this maps the ones RN actually sends to their closest `Easing` equivalent
// so the footer's own animation tracks the keyboard's rather than fighting it.
function mapKeyboardEasing(curve: KeyboardEvent["easing"] | undefined) {
  switch (curve) {
    case "easeIn":
      return Easing.in(Easing.ease);
    case "easeInEaseOut":
      return Easing.inOut(Easing.ease);
    case "linear":
      return Easing.linear;
    default:
      return Easing.out(Easing.ease);
  }
}

function SeatRect({
  seat,
  colors,
  isDraftSeat,
  onPress,
}: {
  seat: ScaledSeat;
  colors: ReturnType<typeof useThemeColors>;
  isDraftSeat: boolean;
  onPress: () => void;
}) {
  const position = { left: seat.x, top: seat.y, width: seat.scaledWidth, height: seat.scaledHeight };

  if (!seat.selectable) {
    // Aisle gaps / screen-border filler: occupies its layout space so the
    // room's true shape reads, but is otherwise invisible and untappable.
    return <View pointerEvents="none" style={[styles.seat, position]} />;
  }

  const hasFriend = (seat.friend_count ?? 0) > 0;
  // Priority: your own draft pick reads clearly regardless of what else is
  // true about the seat; a friend's seat is the next most useful thing to
  // see. Free/taken are both plain, solid grays — deliberately the least
  // eye-catching pair, since both are equally selectable and neither should
  // read as more important than the other.
  const backgroundColor = isDraftSeat
    ? colors.green.secondary
    : hasFriend
      ? colors.blue.primary
      : seat.taken
        ? colors.seatTaken
        : colors.seatFree;
  const showFriendBadge = hasFriend && (seat.friend_count ?? 0) > 1 && seat.scaledWidth >= 16;

  return (
    <TouchableOpacity
      style={[styles.seat, position]}
      hitSlop={{
        top: seat.hitSlopY,
        bottom: seat.hitSlopY,
        left: seat.hitSlopX,
        right: seat.hitSlopX,
      }}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Seat ${seat.row_name}${seat.seat_name}`}
    >
      <View style={[StyleSheet.absoluteFill, styles.seatFill, { backgroundColor }]} />
      {showFriendBadge ? (
        <View style={[styles.friendBadge, { backgroundColor: colors.blue.secondary }]}>
          <ThemedText style={styles.friendBadgeText}>{seat.friend_count}</ThemedText>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function SeatFloorPlan({
  visible,
  room,
  seats,
  isLoading,
  isError,
  cinemaName,
  movieTitle,
  dateLabel,
  timeRangeLabel,
  seatRowDraft,
  seatNumberDraft,
  onChangeSeatRowDraft,
  onChangeSeatNumberDraft,
  seatInputConfig,
  seatValidationError,
  canSave,
  isSaving,
  onSelectSeat,
  onSave,
  onCancel,
}: SeatFloorPlanProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  // The grid's own available space, measured from the actual rendered body —
  // not estimated from window dimensions minus guessed header/footer heights
  // — and only updated while the keyboard is closed, so opening it can never
  // resize the grid (see the file header comment for why).
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  // Starts at a reasonable guess so the footer doesn't flash unpadded before
  // its first real onLayout measurement lands.
  const [footerHeight, setFooterHeight] = useState(FOOTER_HEIGHT);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  // Drives the footer's `bottom` offset directly so it can be animated in
  // step with the keyboard instead of snapping to a new position once RN
  // tells us the keyboard is (now) fully shown/hidden.
  const footerBottom = useRef(new Animated.Value(insets.bottom)).current;

  useEffect(() => {
    const animateFooterTo = (toValue: number, event: KeyboardEvent) => {
      Animated.timing(footerBottom, {
        toValue,
        duration: event.duration || DEFAULT_KEYBOARD_ANIMATION_MS,
        easing: mapKeyboardEasing(event.easing),
        useNativeDriver: false,
      }).start();
    };
    const handleShow = (event: KeyboardEvent) => {
      setIsKeyboardVisible(true);
      animateFooterTo(event.endCoordinates.height, event);
    };
    const handleHide = (event: KeyboardEvent) => {
      setIsKeyboardVisible(false);
      animateFooterTo(insets.bottom, event);
    };
    // iOS fires `keyboardWill*` before the OS animation starts, carrying its
    // real duration/easing — using `keyboardDid*` there (which fires once the
    // animation is already done) is exactly what caused the footer to snap
    // into place instead of moving with the keyboard. Android has no `will`
    // variant, so it stays on `did*` there.
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, handleShow);
    const hideSubscription = Keyboard.addListener(hideEvent, handleHide);
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [footerBottom, insets.bottom]);

  const layout = useMemo(
    () => layoutSeatFloorPlan(seats ?? [], { availableWidth: bodySize.width, availableHeight: bodySize.height }),
    [seats, bodySize.width, bodySize.height]
  );

  const draftRow = seatRowDraft.trim();
  const draftNumber = seatNumberDraft.trim();

  const handleSelect = (seat: ScaledSeat) => {
    if (!seat.selectable || isKeyboardVisible) return;
    triggerSelectionHaptic();
    onSelectSeat(seat.row_name, seat.seat_name);
  };

  const showEmptyState = !isLoading && (isError || !seats || seats.length === 0);

  return (
    <Modal
      transparent={false}
      statusBarTranslucent
      visible={visible}
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={[styles.content, { paddingBottom: footerHeight + insets.bottom }]}>
            <View
              style={[
                styles.header,
                { paddingTop: insets.top + HEADER_TOP_PADDING, borderBottomColor: colors.cardBorder },
              ]}
            >
              <View style={styles.headerText}>
                <ThemedText style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {[cinemaName, room].filter(Boolean).join(" · ")}
                </ThemedText>
                <ThemedText style={styles.headerTitle} numberOfLines={1}>
                  {movieTitle ?? "Pick your seat"}
                </ThemedText>
                {dateLabel || timeRangeLabel ? (
                  <ThemedText style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[dateLabel, timeRangeLabel].filter(Boolean).join(" · ")}
                  </ThemedText>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={onCancel}
                hitSlop={10}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <MaterialIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ThemedText style={[styles.explanation, { color: colors.textSecondary }]}>
              This shows your seat to friends going to this screening — it doesn't book
              anything, you'll still need to get your own ticket separately.
            </ThemedText>

            <View
              style={styles.body}
              onLayout={(event) => {
                // Frozen while the keyboard is up so its own footer padding
                // (which shrinks nothing here, but would still fire a resize
                // event on some devices) can never feed back into the grid's
                // size — see the file header comment.
                if (isKeyboardVisible) return;
                const { width, height } = event.nativeEvent.layout;
                setBodySize({ width, height });
              }}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.tint} />
              ) : showEmptyState ? (
                <ThemedText style={styles.emptyStateText}>
                  {isError
                    ? "Couldn't load the seat map right now — you can still enter your seat below."
                    : "No seat map available for this screening — enter your seat below instead."}
                </ThemedText>
              ) : (
                <View
                  style={{ width: layout.width, height: layout.height }}
                  pointerEvents={isKeyboardVisible ? "none" : "auto"}
                >
                  {layout.seats.map((seat) => (
                    <SeatRect
                      key={`${seat.row_name}-${seat.seat_name}-${seat.x}-${seat.y}`}
                      seat={seat}
                      colors={colors}
                      isDraftSeat={
                        draftRow.length > 0 &&
                        draftNumber.length > 0 &&
                        seat.row_name === draftRow &&
                        seat.seat_name === draftNumber
                      }
                      onPress={() => handleSelect(seat)}
                    />
                  ))}
                </View>
              )}
            </View>

            {!showEmptyState && !isLoading ? (
              <View style={styles.legend}>
                <LegendItem label="Free" colors={colors} backgroundColor={colors.seatFree} />
                <LegendItem label="Taken" colors={colors} backgroundColor={colors.seatTaken} />
                <LegendItem label="Friend" colors={colors} backgroundColor={colors.blue.primary} />
                <LegendItem label="You" colors={colors} backgroundColor={colors.green.secondary} />
              </View>
            ) : null}
          </View>
        </TouchableWithoutFeedback>

        <Animated.View style={[styles.footerOverlay, { bottom: footerBottom }]}>
          <View
            onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
            style={[styles.footer, { borderTopColor: colors.cardBorder, backgroundColor: colors.background }]}
          >
            <View style={styles.seatEditorRow}>
              <View style={styles.seatInputGroup}>
                <ThemedText style={[styles.seatInputLabel, { color: colors.textSecondary }]}>Row</ThemedText>
                <TextInput
                  value={seatRowDraft}
                  onChangeText={onChangeSeatRowDraft}
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.seatInput, { borderColor: colors.cardBorder, color: colors.text, backgroundColor: colors.cardBackground }]}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  keyboardType={seatInputConfig.rowKind === "digits" ? "number-pad" : "default"}
                  maxLength={getSeatFieldMaxLength(seatInputConfig.rowKind)}
                />
              </View>
              <ThemedText style={[styles.seatInputSeparator, { color: colors.textSecondary }]}>—</ThemedText>
              <View style={styles.seatInputGroup}>
                <ThemedText style={[styles.seatInputLabel, { color: colors.textSecondary }]}>Seat</ThemedText>
                <TextInput
                  value={seatNumberDraft}
                  onChangeText={onChangeSeatNumberDraft}
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.seatInput, { borderColor: colors.cardBorder, color: colors.text, backgroundColor: colors.cardBackground }]}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  keyboardType={seatInputConfig.seatKind === "digits" ? "number-pad" : "default"}
                  maxLength={getSeatFieldMaxLength(seatInputConfig.seatKind)}
                />
              </View>
            </View>
            {seatValidationError ? (
              <ThemedText style={[styles.validationErrorText, { color: colors.red.secondary }]}>
                {seatValidationError}
              </ThemedText>
            ) : null}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton, { borderColor: colors.cardBorder }]}
                onPress={onCancel}
                activeOpacity={0.8}
              >
                <ThemedText style={[styles.actionButtonText, { color: colors.text }]}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  { backgroundColor: colors.tint },
                  !canSave && styles.actionButtonDisabled,
                ]}
                onPress={onSave}
                activeOpacity={0.8}
                disabled={!canSave || isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <ThemedText style={[styles.actionButtonText, { color: colors.background }]}>Save</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function LegendItem({
  label,
  backgroundColor,
  colors,
}: {
  label: string;
  backgroundColor: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor }]} />
      <ThemedText style={[styles.legendLabel, { color: colors.textSecondary }]}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerText: { flex: 1, gap: 2 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerSubtitle: { fontSize: 12 },
  closeButton: { padding: 2 },
  explanation: {
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  legend: {
    height: LEGEND_HEIGHT,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch: { width: 13, height: 13, borderRadius: 3 },
  legendLabel: { fontSize: 11 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  seat: { position: "absolute" },
  seatFill: { borderRadius: 4 },
  friendBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  friendBadgeText: { fontSize: 9, fontWeight: "700", color: "#fff" },
  emptyStateText: { fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  // Positioned by its parent's `bottom` (insets.bottom, or the live keyboard
  // height while it's up) rather than its own padding — see the file header
  // comment for why the footer is a decoupled absolute overlay.
  footerOverlay: { position: "absolute", left: 0, right: 0 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  seatEditorRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 12 },
  seatInputGroup: { alignItems: "center", gap: 4 },
  seatInputLabel: { fontSize: 11, fontWeight: "600" },
  seatInputSeparator: { fontSize: 16, paddingBottom: 10 },
  seatInput: {
    width: 52,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: "center",
  },
  validationErrorText: { fontSize: 11, marginTop: -2 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: { borderWidth: 1 },
  actionButtonDisabled: { opacity: 0.4 },
  actionButtonText: { fontSize: 15, fontWeight: "700" },
});
