/**
 * Full-screen visual seat picker for cinemas whose room we have a floor plan
 * for (currently Filmhallen, The Movies, Kino, Filmkoepel, Louis Hartlooper,
 * Slachtstraat and Springhaver — see `backend/scripts/ingest-seat-floor-plans.py`).
 *
 * Deliberately generic: it never receives a cinema identifier, only seat
 * geometry + status, so every room renders the same plain colored rectangles
 * regardless of which cinema it belongs to — a plain `Modal` (like the text
 * seat editor it sits alongside), not a bottom sheet, since a pannable room
 * needs more space than a partial-height sheet gives.
 */
import { useMemo } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { SeatFloorPlanSeatPublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import { getAvatarColors } from "@/utils/avatar-color";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { layoutSeatFloorPlan, type ScaledSeat } from "@/components/showtimes/seat-floor-plan-layout";

type SeatFloorPlanProps = {
  visible: boolean;
  room: string | null;
  seats: SeatFloorPlanSeatPublic[] | null;
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
  onSelectSeat: (rowName: string, seatName: string) => void;
  /** Lets the user bail out to the plain row/seat text fields. */
  onUseTextInputInstead: () => void;
};

const HEADER_HEIGHT = 56;
const LEGEND_HEIGHT = 40;

function SeatRect({
  seat,
  colors,
  onPress,
}: {
  seat: ScaledSeat;
  colors: ReturnType<typeof useThemeColors>;
  onPress: (() => void) | null;
}) {
  const position = { left: seat.x, top: seat.y, width: seat.scaledWidth, height: seat.scaledHeight };

  if (!seat.selectable) {
    // Aisle gaps / screen-border filler: occupies its layout space so the
    // room's true shape reads, but is otherwise invisible and untappable.
    return <View pointerEvents="none" style={[styles.seat, position]} />;
  }

  const friend = seat.friend ?? null;
  const friendColors = friend ? getAvatarColors(friend.id, colors) : null;
  const backgroundColor = seat.is_viewer_seat
    ? colors.green.secondary
    : friendColors
      ? friendColors.primary
      : seat.taken
        ? colors.surfaceMuted
        : "transparent";
  const borderColor = seat.is_viewer_seat
    ? colors.green.secondary
    : friendColors
      ? friendColors.secondary
      : seat.taken
        ? colors.pillBorder
        : colors.tint;
  const fillStyle = [styles.seatFill, { backgroundColor, borderColor }];

  if (!onPress) {
    return <View style={[styles.seat, position, ...fillStyle]} />;
  }
  return (
    <TouchableOpacity
      style={[styles.seat, position]}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Seat ${seat.row_name}${seat.seat_name}`}
    >
      <View style={[StyleSheet.absoluteFill, ...fillStyle]} />
    </TouchableOpacity>
  );
}

export default function SeatFloorPlan({
  visible,
  room,
  seats,
  isLoading,
  isError,
  onClose,
  onSelectSeat,
  onUseTextInputInstead,
}: SeatFloorPlanProps) {
  const colors = useThemeColors();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const availableWidth = windowWidth;
  const availableHeight = windowHeight - HEADER_HEIGHT - LEGEND_HEIGHT;

  const layout = useMemo(
    () => layoutSeatFloorPlan(seats ?? [], { availableWidth, availableHeight }),
    [seats, availableWidth, availableHeight]
  );

  const handleSelect = (seat: ScaledSeat) => {
    if (!seat.selectable || seat.taken) return;
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
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.cardBorder }]}>
          <ThemedText style={styles.headerTitle} numberOfLines={1}>
            {room ?? "Pick your seat"}
          </ThemedText>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <MaterialIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {isLoading ? (
            <ActivityIndicator color={colors.tint} />
          ) : showEmptyState ? (
            <View style={styles.emptyState}>
              <ThemedText style={styles.emptyStateText}>
                {isError
                  ? "Couldn't load the seat map right now."
                  : "No seat map available for this screening."}
              </ThemedText>
              <TouchableOpacity
                style={[styles.fallbackButton, { borderColor: colors.tint }]}
                onPress={onUseTextInputInstead}
                accessibilityRole="button"
              >
                <ThemedText style={[styles.fallbackButtonText, { color: colors.tint }]}>
                  Enter seat manually
                </ThemedText>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ width: layout.width, height: layout.height }}>
              {layout.seats.map((seat) => (
                <SeatRect
                  key={`${seat.row_name}-${seat.seat_name}-${seat.x}-${seat.y}`}
                  seat={seat}
                  colors={colors}
                  onPress={seat.selectable && !seat.taken ? () => handleSelect(seat) : null}
                />
              ))}
            </View>
          )}
        </View>

        <View style={[styles.legend, { borderTopColor: colors.cardBorder }]}>
          <LegendItem
            label="Free"
            colors={colors}
            backgroundColor="transparent"
            borderColor={colors.tint}
          />
          <LegendItem
            label="Taken"
            colors={colors}
            backgroundColor={colors.surfaceMuted}
            borderColor={colors.pillBorder}
          />
          <LegendItem
            label="You"
            colors={colors}
            backgroundColor={colors.green.secondary}
            borderColor={colors.green.secondary}
          />
        </View>
      </View>
    </Modal>
  );
}

function LegendItem({
  label,
  backgroundColor,
  borderColor,
  colors,
}: {
  label: string;
  backgroundColor: string;
  borderColor: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor, borderColor }]} />
      <ThemedText style={[styles.legendLabel, { color: colors.textSecondary }]}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  seat: {
    position: "absolute",
  },
  seatFill: { flex: 1, borderRadius: 4, borderWidth: 1.5 },
  emptyState: { alignItems: "center", gap: 14, paddingHorizontal: 32 },
  emptyStateText: { fontSize: 14, textAlign: "center" },
  fallbackButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  fallbackButtonText: { fontSize: 14, fontWeight: "600" },
  legend: {
    height: LEGEND_HEIGHT,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5 },
  legendLabel: { fontSize: 12 },
});
