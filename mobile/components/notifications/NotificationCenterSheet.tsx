/**
 * The notification-centre bottom sheet (gorhom BottomSheetModal, mirroring
 * ShowtimeActionModal's present/close mechanics). Presentational: driven by the
 * controlled `visible` prop and handlers from NotificationCenterProvider.
 */
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NotificationFeedItem } from "shared";

import NotificationRow from "@/components/notifications/NotificationRow";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { useThemeColors } from "@/hooks/use-theme-color";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

type NotificationCenterSheetProps = {
  visible: boolean;
  items: NotificationFeedItem[];
  isLoading: boolean;
  pendingAcceptId: string | null;
  pendingDeclineId: string | null;
  onClose: () => void;
  onItemPress: (item: NotificationFeedItem) => void;
  onDismiss: (item: NotificationFeedItem) => void;
  onAccept: (item: NotificationFeedItem) => void;
  onDecline: (item: NotificationFeedItem) => void;
};

export default function NotificationCenterSheet({
  visible,
  items,
  isLoading,
  pendingAcceptId,
  pendingDeclineId,
  onClose,
  onItemPress,
  onDismiss,
  onAccept,
  onDecline,
}: NotificationCenterSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { bottom: bottomInset } = useSafeAreaInsets();

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="Notifications">
      <BottomSheetScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && items.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centered}>
            <MaterialIcons name="notifications-none" size={40} color={colors.textSecondary} />
            <Text style={styles.emptyText}>You&apos;re all caught up</Text>
          </View>
        ) : (
          items.map((item) => (
            <NotificationRow
              key={`${item.source}-${item.id}`}
              item={item}
              onPress={onItemPress}
              onDismiss={onDismiss}
              onAccept={onAccept}
              onDecline={onDecline}
              isAccepting={pendingAcceptId === item.id}
              isDeclining={pendingDeclineId === item.id}
            />
          ))
        )}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    scrollContent: {
      flexGrow: 1,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 64,
      gap: 10,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
  });
