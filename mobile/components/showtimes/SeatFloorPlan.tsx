/**
 * Visual seat picker for cinemas whose room we have a floor plan for
 * (currently Filmhallen, The Movies, Kino, Filmkoepel, Louis Hartlooper,
 * Slachtstraat and Springhaver — see `backend/scripts/ingest-seat-floor-plans.py`).
 *
 * Deliberately generic: it never receives a cinema identifier, only seat
 * geometry + status, so every room renders the same plain colored rectangles
 * regardless of which cinema it belongs to. A full-height `AppBottomSheet`
 * (pull-down-to-close, like every other sheet in the app) rather than the
 * plain text seat editor's `Modal` — this one has a room to look at and
 * benefits from being dismissable the same way the rest of the app is; the
 * "Select your seat" sheet title makes it unambiguous what tapping a seat
 * below does.
 *
 * This is purely a *picker*, not a booking flow: any seat can be tapped,
 * including one the live read says is taken — the common case is picking the
 * seat you already bought a ticket for elsewhere. Tapping a seat only fills
 * the row/seat fields below (or vice versa, typing them highlights the
 * matching seat); nothing saves until "Save" is pressed, so the parent's
 * existing draft state (`seatRowDraft`/`seatNumberDraft`) is the single
 * source of truth for both this screen and the plain-text fallback dialog.
 *
 * The footer (row/seat fields + Save/Cancel) is a plain flex sibling of the
 * seat grid above it, pinned to the bottom the same way every other sheet in
 * the app pins a footer below its `BottomSheetScrollView`. Keyboard avoidance
 * — i.e. moving/resizing the sheet itself as the keyboard opens — is left
 * entirely to the `BottomSheetModal` (`AppBottomSheet`) itself and to
 * `BottomSheetTextInput` on the row/seat fields — an earlier version of this
 * screen hand-rolled its own `Animated`-driven keyboard *positioning* (built
 * back when this was a plain `Modal`, which has no keyboard awareness of its
 * own), and once this became a real bottom sheet that custom tracking fought
 * the sheet's built-in handling: typing flickered and the footer overshot far
 * above the keyboard. Do not reintroduce a footer-positioning `Keyboard`
 * listener. The one `Keyboard` listener that *is* still here (see
 * `isKeyboardTransitioning`) doesn't position anything — it only freezes the
 * grid's own size measurement for the ~250ms the keyboard is animating, so
 * the grid doesn't rescale-and-relayout every seat on each intermediate
 * `onLayout` the sheet's resize fires along the way.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Keyboard,
  Platform,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SeatFloorPlanSeatPublic } from "shared";

import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { ThemedText } from "@/components/themed-text";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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

const FULL_HEIGHT_SNAP_POINTS = ["100%"];
const LEGEND_HEIGHT = 34;
// How long the row/seat fields wait for typing to pause before syncing the
// parent sheet's copy of the draft — short enough that Save/validation still
// feel responsive, long enough to collapse a normal typing burst into one
// parent re-render instead of one per character.
const SEAT_DRAFT_DEBOUNCE_MS = 150;

// Memoized: with ~150-300 seats in a room, an inline `onPress` closure per
// seat (recreated every render) defeated memoization entirely, so every seat
// re-rendered on every keystroke in the row/seat fields below — that
// synchronous re-render of the whole grid was heavy enough to visibly stall
// the (otherwise perfectly responsive) `BottomSheetTextInput`, reading as the
// typed character flickering in and out. Taking a stable `onSelect` instead
// (bound once by the parent via `useCallback`) means only the one or two
// seats whose `isDraftSeat` actually flips need to re-render per keystroke.
export const SeatRect = memo(function SeatRect({
  seat,
  colors,
  isDraftSeat,
  onSelect,
  interactive = true,
}: {
  seat: ScaledSeat;
  colors: ReturnType<typeof useThemeColors>;
  isDraftSeat: boolean;
  onSelect?: (seat: ScaledSeat) => void;
  /** False renders a plain, untappable swatch — used by the read-only preview. */
  interactive?: boolean;
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
    ? colors.seatYou
    : hasFriend
      ? colors.seatFriend
      : seat.taken
        ? colors.seatTaken
        : colors.seatFree;
  const showFriendBadge = hasFriend && (seat.friend_count ?? 0) > 1 && seat.scaledWidth >= 16;

  if (!interactive) {
    return (
      <View style={[styles.seat, position]} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, styles.seatFill, { backgroundColor }]} />
        {showFriendBadge ? (
          <View style={[styles.friendBadge, { backgroundColor: colors.blue.secondary }]}>
            <ThemedText style={styles.friendBadgeText}>{seat.friend_count}</ThemedText>
          </View>
        ) : null}
      </View>
    );
  }

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
      onPress={() => onSelect?.(seat)}
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
});

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
  // frozen while the keyboard is opening/closing so the ~250ms transition
  // doesn't force a full rescale-and-relayout of every seat on each of the
  // many `onLayout` events the sheet's own keyboard-avoidance fires along the
  // way (that per-frame reflow, not the keyboard animation itself, was what
  // read as janky/slow). This only gates the *measurement* — it doesn't
  // position anything itself, so it doesn't reintroduce the footer-tracking
  // system removed above; the grid simply keeps its pre-keyboard size and
  // snaps to the real one once the transition settles.
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [isKeyboardTransitioning, setIsKeyboardTransitioning] = useState(false);

  // The seat grid itself — up to ~150-300 mounted `SeatRect` touchables plus
  // the layout pass over them — is heavy enough on slower devices to visibly
  // delay the sheet's own rise if it's built in the same tick that presents
  // it. Rather than block the open on that, the sheet always rises instantly
  // showing the loading spinner, and the grid is only built once the sheet's
  // entry animation is out of the way — the data is usually already in hand
  // (prefetched before the seat button was ever tapped), so this reads as the
  // seats popping in a beat after the sheet, not as the sheet itself being slow.
  const [isGridReady, setIsGridReady] = useState(false);
  useEffect(() => {
    if (!visible) {
      setIsGridReady(false);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => setIsGridReady(true));
    return () => task.cancel();
  }, [visible]);

  useEffect(() => {
    // iOS fires `keyboardWill*` before the animated resize starts and
    // `keyboardDid*` once it's finished, so the freeze window brackets the
    // transition exactly. Android has no `will*` event — its own show/hide
    // is a single fast resize rather than the longer animated one iOS does,
    // so there's no equivalent window worth freezing for.
    if (Platform.OS !== "ios") return;
    const beginTransition = () => setIsKeyboardTransitioning(true);
    const endTransition = () => setIsKeyboardTransitioning(false);
    const willShowSubscription = Keyboard.addListener("keyboardWillShow", beginTransition);
    const willHideSubscription = Keyboard.addListener("keyboardWillHide", beginTransition);
    const showSubscription = Keyboard.addListener("keyboardDidShow", endTransition);
    const hideSubscription = Keyboard.addListener("keyboardDidHide", endTransition);
    return () => {
      willShowSubscription.remove();
      willHideSubscription.remove();
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Skipped entirely until the grid is due to render — this is the actual
  // expensive part (not just mounting the `SeatRect`s), so computing it
  // eagerly on mount would undo the point of deferring below.
  const layout = useMemo(
    () =>
      isGridReady
        ? layoutSeatFloorPlan(seats ?? [], { availableWidth: bodySize.width, availableHeight: bodySize.height })
        : { width: 0, height: 0, seats: [] },
    [isGridReady, seats, bodySize.width, bodySize.height]
  );

  // The row/seat fields' *own* draft, separate from the parent's copy of the
  // same two strings. Typing into a `BottomSheetTextInput` bound directly to
  // `seatRowDraft`/`seatNumberDraft` up on `ShowtimeActionModal` meant every
  // keystroke re-rendered that entire (very large) sheet before the character
  // could show up here — that round trip, not the seat grid, turned out to be
  // the actual source of the flicker the memoized `SeatRect` change didn't
  // fix. So typing updates only this local state immediately, and the parent
  // is kept in sync via `useDebouncedValue` instead of on every keystroke —
  // it only needs the settled value to compute `canSave`/validation, not a
  // live one. Seeded once from the initial props: this whole screen is thrown
  // away and remounted fresh on each open (`dismissWhenClosed`), so there's
  // no case where the parent's value changes out from under this later.
  const [localSeatRowDraft, setLocalSeatRowDraft] = useState(seatRowDraft);
  const [localSeatNumberDraft, setLocalSeatNumberDraft] = useState(seatNumberDraft);
  const debouncedSeatRowDraft = useDebouncedValue(localSeatRowDraft, SEAT_DRAFT_DEBOUNCE_MS);
  const debouncedSeatNumberDraft = useDebouncedValue(localSeatNumberDraft, SEAT_DRAFT_DEBOUNCE_MS);

  useEffect(() => {
    onChangeSeatRowDraft(debouncedSeatRowDraft);
  }, [debouncedSeatRowDraft, onChangeSeatRowDraft]);

  useEffect(() => {
    onChangeSeatNumberDraft(debouncedSeatNumberDraft);
  }, [debouncedSeatNumberDraft, onChangeSeatNumberDraft]);

  const draftRow = localSeatRowDraft.trim();
  const draftNumber = localSeatNumberDraft.trim();

  // Stable across renders (see `SeatRect`'s own comment on why that matters):
  // passed straight through as each seat's `onSelect` rather than rebound
  // inline per seat. Tapping a seat updates the local draft directly (for the
  // fields/highlight to reflect it instantly) and informs the parent
  // immediately rather than through the debounce above — it's one discrete
  // action, not a burst of keystrokes, so there's no re-render storm to guard
  // against here.
  const handleSelect = useCallback(
    (seat: ScaledSeat) => {
      if (!seat.selectable) return;
      triggerSelectionHaptic();
      setLocalSeatRowDraft(seat.row_name);
      setLocalSeatNumberDraft(seat.seat_name);
      onSelectSeat(seat.row_name, seat.seat_name);
    },
    [onSelectSeat]
  );

  const showEmptyState = !isLoading && isGridReady && (isError || !seats || seats.length === 0);
  const showGridSpinner = isLoading || !isGridReady;

  // Swiping the sheet down (or the header's close button, or the Android
  // back button — anything that isn't the explicit Cancel button below)
  // shouldn't silently discard a seat that's ready to save: it behaves as a
  // Save when one is possible, and only falls back to a plain close/cancel
  // when it isn't. The Cancel button itself stays a literal cancel — that's
  // the one affordance whose whole purpose is discarding the draft.
  const handleDismiss = () => {
    if (canSave && !isSaving) {
      onSave();
      return;
    }
    onCancel();
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={handleDismiss}
      title="Select your seat"
      snapPoints={FULL_HEIGHT_SNAP_POINTS}
      // Can be opened from on top of the showtime sheet, so it must not stay
      // mounted behind it after a first close — see AppBottomSheet's own doc
      // comment on `dismissWhenClosed`.
      dismissWhenClosed
    >
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <BottomSheetScrollView scrollEnabled={false} contentContainerStyle={styles.content}>
            <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {[movieTitle, cinemaName, room].filter(Boolean).join(" · ")}
            </ThemedText>
            {dateLabel || timeRangeLabel ? (
              <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {[dateLabel, timeRangeLabel].filter(Boolean).join(" · ")}
              </ThemedText>
            ) : null}

            <ThemedText style={[styles.explanation, { color: colors.textSecondary }]}>
              This shows your seat to friends going to this screening. This doesn't book
              anything, you'll still need to get your own ticket separately.
            </ThemedText>

            <View
              style={styles.body}
              onLayout={(event) => {
                if (isKeyboardTransitioning) return;
                const { width, height } = event.nativeEvent.layout;
                setBodySize({ width, height });
              }}
            >
              {showGridSpinner ? (
                <ActivityIndicator color={colors.tint} />
              ) : showEmptyState ? (
                <ThemedText style={styles.emptyStateText}>
                  {isError
                    ? "Couldn't load the seat map right now — you can still enter your seat below."
                    : "No seat map available for this screening — enter your seat below instead."}
                </ThemedText>
              ) : (
                <View style={{ width: layout.width, height: layout.height }}>
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
                      onSelect={handleSelect}
                    />
                  ))}
                </View>
              )}
            </View>

            {!showEmptyState && !showGridSpinner ? (
              <View style={styles.legend}>
                <LegendItem label="Free" colors={colors} backgroundColor={colors.seatFree} />
                <LegendItem label="Taken" colors={colors} backgroundColor={colors.seatTaken} />
                <LegendItem label="Friend" colors={colors} backgroundColor={colors.seatFriend} />
                <LegendItem label="You" colors={colors} backgroundColor={colors.seatYou} />
              </View>
            ) : null}
          </BottomSheetScrollView>
        </TouchableWithoutFeedback>

        <View
          style={[
            styles.footer,
            { paddingBottom: 12 + insets.bottom, borderTopColor: colors.cardBorder, backgroundColor: colors.background },
          ]}
        >
          <View style={styles.seatEditorRow}>
            <View style={styles.seatInputGroup}>
              <ThemedText style={[styles.seatInputLabel, { color: colors.textSecondary }]}>Row</ThemedText>
              <BottomSheetTextInput
                value={localSeatRowDraft}
                onChangeText={setLocalSeatRowDraft}
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
              <BottomSheetTextInput
                value={localSeatNumberDraft}
                onChangeText={setLocalSeatNumberDraft}
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
      </View>
    </AppBottomSheet>
  );
}

export function LegendItem({
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
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 10 },
  subtitle: { fontSize: 12, textAlign: "center" },
  explanation: {
    fontSize: 11,
    lineHeight: 15,
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
  // A plain flex sibling below the scroll view — its own `paddingBottom`
  // (set inline, adding `insets.bottom`) is all it needs to clear the home
  // indicator; the sheet's own keyboard handling takes care of the rest.
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
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
