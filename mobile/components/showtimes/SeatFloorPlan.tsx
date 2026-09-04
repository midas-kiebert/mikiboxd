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
 * matching seat); nothing saves until "Save" is pressed, which hands the
 * finished pair back through `onSave`.
 *
 * The draft — and everything derived from it: validation, whether Save is
 * enabled — lives entirely in here, seeded from the seat already saved on the
 * showtime each time the sheet opens. It deliberately does *not* stream back
 * up to `ShowtimeActionModal` as you type: that sheet is a very large tree,
 * and re-rendering it on every keystroke is what made typing here stall (an
 * earlier fix debounced the sync to soften that; owning the draft outright
 * removes the round trip instead of hiding it). The parent only hears about a
 * seat when one is actually saved.
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
 * `isKeyboardOpen`) doesn't position anything — it only freezes the grid's
 * own size measurement for as long as the keyboard is up, so the grid
 * doesn't rescale-and-relayout every seat on each intermediate `onLayout`
 * the sheet's resize fires along the way. The room is left clipped rather
 * than shrunk to fit; see `isKeyboardOpen`'s own comment.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ScreenSide, SeatFloorPlanSeatPublic } from "shared";

import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import {
  getSeatFieldMaxLength,
  validateSeatFieldValue,
  type SeatInputConfig,
} from "@/components/showtimes/seat-input";
import { layoutSeatFloorPlan, type ScaledSeat } from "@/components/showtimes/seat-floor-plan-layout";

type SeatFloorPlanProps = {
  visible: boolean;
  room: string | null;
  seats: SeatFloorPlanSeatPublic[] | null;
  /** Which end of `seats` the screen is at — a fact about the room, stored. */
  screenSide: ScreenSide;
  isLoading: boolean;
  isError: boolean;
  cinemaName: string | null;
  movieTitle: string | null;
  dateLabel: string | null;
  timeRangeLabel: string | null;
  /** The seat already saved on the showtime; seeds the fields on each open. */
  savedSeatRow: string | null;
  savedSeatNumber: string | null;
  seatInputConfig: SeatInputConfig;
  isSaving: boolean;
  onSave: (seat: { seatRow: string | null; seatNumber: string | null }) => void;
  onCancel: () => void;
};

const FULL_HEIGHT_SNAP_POINTS = ["100%"];
const LEGEND_HEIGHT = 34;

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

  // The colour goes straight onto the seat's own view. It used to be painted
  // by a separate absolutely-filled child, which doubled the native view count
  // of the whole room for nothing — and view count is what this screen's
  // open/close cost is made of (see `useSheetContentReady`).
  const badge = showFriendBadge ? (
    <View style={[styles.friendBadge, { backgroundColor: colors.blue.secondary }]}>
      <ThemedText style={styles.friendBadgeText}>{seat.friend_count}</ThemedText>
    </View>
  ) : null;

  if (!interactive) {
    return (
      <View style={[styles.seat, styles.seatFill, position, { backgroundColor }]} pointerEvents="none">
        {badge}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.seat, styles.seatFill, position, { backgroundColor }]}
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
      {badge}
    </TouchableOpacity>
  );
});

// Purely an orientation cue — no cinema gives us screen *geometry*, so this is
// a fixed-height bar sized to the room's own scaled width rather than anything
// derived from the seat data. Shared with `SeatFloorPlanPreview` so the two
// sheets read identically. Its height must stay in step with
// `SCREEN_INDICATOR_HEIGHT` in `seat-floor-plan-layout.ts`, which reserves the
// space for it beside the seat grid.
//
// Which end it goes at comes from the room, via `screen_side` on the stored
// floor plan, and is deliberately not inferred here. The tempting rule — put
// it at whichever end row 1 is, since row 1 is the row nearest the screen —
// gets Filmhuis Alkmaar exactly backwards: it numbers its rows from the back.
// Only Tricket states the side outright (its seat map draws the screen line
// itself); everywhere else the backend defaults to top and takes a correction
// from `seat_screen_side_overrides.yaml`.
export function ScreenIndicator({
  width,
  side,
  colors,
}: {
  width: number;
  side: ScreenSide;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View
      style={[
        styles.screenIndicator,
        side === "bottom" ? styles.screenIndicatorBottom : styles.screenIndicatorTop,
        { width },
      ]}
    >
      <View style={[styles.screenBar, { backgroundColor: colors.textSecondary }]} />
      <ThemedText style={[styles.screenLabel, { color: colors.textSecondary }]}>SCREEN</ThemedText>
    </View>
  );
}

export default function SeatFloorPlan({
  visible,
  room,
  seats,
  screenSide,
  isLoading,
  isError,
  cinemaName,
  movieTitle,
  dateLabel,
  timeRangeLabel,
  savedSeatRow,
  savedSeatNumber,
  seatInputConfig,
  isSaving,
  onSave,
  onCancel,
}: SeatFloorPlanProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  // The grid's own available space, measured from the actual rendered body —
  // and deliberately *not* re-measured for as long as the keyboard is up.
  //
  // The room keeps the size it had before the keyboard appeared and is simply
  // clipped by the body's `overflow: hidden` if it no longer fits. That is the
  // intended behaviour: rescaling ~300 seats to fit the leftover space means a
  // full relayout of the room on every `onLayout` the sheet's keyboard
  // avoidance fires, which reads as the seat map slowly juddering smaller
  // underneath you. A room you can only partly see while typing is much better
  // than one that never stops moving; it snaps back to the full space once the
  // keyboard is gone. This only gates the *measurement* — it doesn't position
  // anything itself, so it doesn't reintroduce the footer-tracking system
  // removed above.
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // What the row/seat fields held just before the keyboard came up, so Cancel
  // can put them back — see `handleCancelPress`. Read from a ref rather than
  // captured in the listener below, which is bound once.
  const draftsRef = useRef({ row: "", number: "" });
  const preKeyboardDraftRef = useRef<{ row: string; number: string } | null>(null);

  useEffect(() => {
    const onKeyboardShown = () => {
      // Only the first show of a run is the "before" state — tapping from the
      // row field straight into the seat field fires no new event anyway.
      preKeyboardDraftRef.current ??= draftsRef.current;
      setIsKeyboardOpen(true);
    };
    const onKeyboardHidden = () => {
      // Dismissing the keyboard any other way (tapping the map, the return
      // key) means the typed value stands, so the snapshot is spent.
      preKeyboardDraftRef.current = null;
      setIsKeyboardOpen(false);
    };
    // iOS announces the resize before it starts; Android only once it has
    // happened. Take the earliest signal each platform offers so the freeze is
    // in place before the body starts shrinking. Unfreezing waits for the
    // settled `did` event on both, so the one re-measure that does happen
    // reads the body at its final full height rather than mid-restore.
    const showSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      onKeyboardShown
    );
    const hideSubscription = Keyboard.addListener("keyboardDidHide", onKeyboardHidden);
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Mounting the grid is the expensive part of this screen, and the expense is
  // not JavaScript: a room is 150-300 seats, each a native view, and native
  // views are created and destroyed on the UI thread — the same thread the
  // sheet's own animation runs on. None of that happens inside either
  // animation any more, and not because of anything in here: `AppBottomSheet`
  // holds every sheet's body back until the sheet has arrived and keeps it up
  // through the close (see `useSheetContentReady`), which is exactly the
  // treatment this screen used to have to arrange for itself.
  const layout = useMemo(
    () =>
      layoutSeatFloorPlan(seats ?? [], {
        availableWidth: bodySize.width,
        availableHeight: bodySize.height,
      }),
    [seats, bodySize.width, bodySize.height]
  );

  // The row/seat draft, owned outright here rather than mirrored up to
  // `ShowtimeActionModal` — see this file's header comment for why. Re-seeded
  // from the saved seat on each *open* rather than only at mount: this
  // component stays mounted between opens (a sheet's own `visible` unmounts the
  // sheet's portal node, not the component that renders it), so without this
  // a draft abandoned on one showtime would still be sitting in the fields
  // the next time the picker came up on another.
  const [localSeatRowDraft, setLocalSeatRowDraft] = useState(savedSeatRow ?? "");
  const [localSeatNumberDraft, setLocalSeatNumberDraft] = useState(savedSeatNumber ?? "");
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setLocalSeatRowDraft(savedSeatRow ?? "");
      setLocalSeatNumberDraft(savedSeatNumber ?? "");
    }
    wasVisibleRef.current = visible;
  }, [visible, savedSeatRow, savedSeatNumber]);

  // Mirrored into a ref purely so the keyboard listener above (bound once, on
  // mount) can read the live draft without needing to be rebound on every
  // keystroke.
  useEffect(() => {
    draftsRef.current = { row: localSeatRowDraft, number: localSeatNumberDraft };
  }, [localSeatRowDraft, localSeatNumberDraft]);

  const draftRow = localSeatRowDraft.trim();
  const draftNumber = localSeatNumberDraft.trim();

  // Stable across renders (see `SeatRect`'s own comment on why that matters):
  // passed straight through as each seat's `onSelect` rather than rebound
  // inline per seat.
  const handleSelect = useCallback((seat: ScaledSeat) => {
    if (!seat.selectable) return;
    triggerSelectionHaptic();
    setLocalSeatRowDraft(seat.row_name);
    setLocalSeatNumberDraft(seat.seat_name);
  }, []);

  // Same rules the plain-text seat dialog applies up on `ShowtimeActionModal`,
  // evaluated here so nothing has to round-trip through that sheet to know
  // whether Save should light up.
  const normalizedRow = draftRow || null;
  const normalizedNumber = draftNumber || null;
  const seatValidationError =
    validateSeatFieldValue(normalizedRow, seatInputConfig.rowKind, "Row") ??
    validateSeatFieldValue(normalizedNumber, seatInputConfig.seatKind, "Seat");
  // Row and seat must be set (or cleared) together — silently blocks Save
  // rather than showing an error, since it's just an in-progress edit.
  const isSeatPairIncomplete = (normalizedRow === null) !== (normalizedNumber === null);
  const hasSeatChanges =
    normalizedRow !== (savedSeatRow?.trim() || null) ||
    normalizedNumber !== (savedSeatNumber?.trim() || null);
  const canSave =
    hasSeatChanges && !isSaving && seatValidationError === null && !isSeatPairIncomplete;

  // Saving closes the sheet, and closing runs `handleDismiss` below, which
  // saves when it can — so without this latch the close a save triggers can
  // come back around and save a second time. Today the in-flight `isSaving`
  // happens to make `canSave` false in that window, but that is timing, not a
  // guarantee; this makes "one save per open" explicit. Cleared on open, not
  // on close, so it still holds for the whole dismiss animation.
  const hasSubmittedRef = useRef(false);
  useEffect(() => {
    if (visible) hasSubmittedRef.current = false;
  }, [visible]);

  const handleSave = useCallback(() => {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;
    onSave({ seatRow: draftRow || null, seatNumber: draftNumber || null });
  }, [onSave, draftRow, draftNumber]);

  const showEmptyState = !isLoading && (isError || !seats || seats.length === 0);
  const showGridSpinner = isLoading;

  // With the keyboard up, Cancel's job is to get out of text-editing, not to
  // leave the sheet: it dismisses the keyboard and puts the fields back to
  // whatever they held just before the keyboard opened, rather than closing
  // over a half-typed value. Only once the keyboard is already down does
  // Cancel fall back to its literal meaning and hand off to `onCancel`.
  const handleCancelPress = () => {
    const preKeyboardDraft = preKeyboardDraftRef.current;
    if (preKeyboardDraft) {
      Keyboard.dismiss();
      setLocalSeatRowDraft(preKeyboardDraft.row);
      setLocalSeatNumberDraft(preKeyboardDraft.number);
      preKeyboardDraftRef.current = null;
      return;
    }
    onCancel();
  };

  // Swiping the sheet down (or the header's close button, or the Android
  // back button — anything that isn't the explicit Cancel button below)
  // shouldn't silently discard a seat that's ready to save: it behaves as a
  // Save when one is possible, and only falls back to a plain close/cancel
  // when it isn't. The Cancel button itself stays a literal cancel — that's
  // the one affordance whose whole purpose is discarding the draft.
  const handleDismiss = () => {
    if (canSave && !isSaving && !hasSubmittedRef.current) {
      handleSave();
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
      // Only ever opened from on top of the showtime sheet, which therefore
      // always registers its portal first — so this one lands in front of it
      // without needing to be rebuilt on every open, which is what it used to
      // do, at a cost of ~300ms before it began to move.
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
                if (isKeyboardOpen) return;
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
                // Out of flow, so the grid can never grow the very box it was
                // measured against — `body` is `flex: 1` inside a scroll
                // view's `flexGrow: 1` content container, which is a *soft*
                // height: a tall room left in flow pushes the content taller,
                // that re-fires `onLayout`, and the room rescales to the size
                // it just caused. Absolutely filling the body instead makes
                // the measurement depend only on the flex layout above it.
                <View style={styles.gridLayer} pointerEvents="box-none">
                  <View style={{ width: layout.width }}>
                    {screenSide === "top" ? (
                      <ScreenIndicator width={layout.width} side="top" colors={colors} />
                    ) : null}
                    <View style={{ height: layout.height }}>
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
                    {screenSide === "bottom" ? (
                      <ScreenIndicator width={layout.width} side="bottom" colors={colors} />
                    ) : null}
                  </View>
                </View>
              )}
            </View>

            {/* The row always holds its height, even before the grid it
                describes has been built. Letting it appear alongside the seats
                would shrink the body underneath them the moment they arrived,
                forcing a second measure-and-rescale of the whole room on every
                open — the same reflow the validation line above avoids. */}
            <View style={styles.legend}>
              {!showEmptyState && !showGridSpinner ? (
                <>
                  <LegendItem label="Free" colors={colors} backgroundColor={colors.seatFree} />
                  <LegendItem label="Taken" colors={colors} backgroundColor={colors.seatTaken} />
                  <LegendItem label="Friend" colors={colors} backgroundColor={colors.seatFriend} />
                  <LegendItem label="You" colors={colors} backgroundColor={colors.seatYou} />
                </>
              ) : null}
            </View>
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
          {/* Always occupies its line, even with nothing to say. Validation is
              evaluated synchronously as you type, so a slot that appears and
              disappears per keystroke would change the footer's height, which
              resizes the `flex: 1` body above it, which re-fires that body's
              `onLayout` and rescales every seat in the room — visible as the
              grid juddering smaller while you type with the keyboard up. The
              explicit lineHeight/height is what keeps it one fixed line (a
              ThemedText left alone brings its own lineHeight: 24). */}
          <ThemedText
            style={[styles.validationErrorText, { color: colors.red.secondary }]}
            numberOfLines={1}
          >
            {seatValidationError ?? ""}
          </ThemedText>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.cancelButton, { borderColor: colors.cardBorder }]}
              onPress={handleCancelPress}
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
              onPress={handleSave}
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
  // Centers the room within whatever `body` was measured at; see its usage.
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  // Height must stay in step with `SCREEN_INDICATOR_HEIGHT` in
  // `seat-floor-plan-layout.ts`, which reserves this space above the grid.
  screenIndicator: { alignItems: "center" },
  screenIndicatorTop: { marginBottom: 8 },
  // Mirrored, and the label leads the bar so the pair still reads outward
  // from the seats rather than upside down.
  screenIndicatorBottom: { marginTop: 8, flexDirection: "column-reverse" },
  screenBar: { width: "70%", height: 4, borderRadius: 2, opacity: 0.5 },
  // Explicit lineHeight, and not a decorative choice: ThemedText's default
  // type ships lineHeight 24, which a fontSize override doesn't touch, so
  // this label was 24pt tall and the whole indicator 40 against the 28
  // `SCREEN_INDICATOR_HEIGHT` reserves for it. The grid was scaled to fit a
  // space 12pt larger than it actually had, and a bottom-screen room paid for
  // it by having its own SCREEN bar clipped off. 4 + 4 + 12 + 8 = 28.
  screenLabel: { fontSize: 9, lineHeight: 12, letterSpacing: 2, marginTop: 4 },
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
  // Fixed height, always rendered — see the comment at its usage.
  validationErrorText: { fontSize: 11, lineHeight: 14, height: 14, marginTop: -2 },
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
