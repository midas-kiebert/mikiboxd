/**
 * The notification-centre bottom sheet (gorhom BottomSheetModal, mirroring
 * ShowtimeActionModal's present/close mechanics). Presentational: driven by the
 * controlled `visible` prop and handlers from NotificationCenterProvider.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, BackHandler, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NotificationFeedItem } from "shared";

import NotificationRow from "@/components/notifications/NotificationRow";
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
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["85%"], []);
  // Drive the gorhom sheet imperatively from the controlled `visible` prop.
  const hasEverPresentedRef = useRef(false);
  const closedByGorhomRef = useRef(false);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        closedByGorhomRef.current = true;
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (visible) {
      hasEverPresentedRef.current = true;
      closedByGorhomRef.current = false;
      bottomSheetModalRef.current?.present();
    } else if (hasEverPresentedRef.current && !closedByGorhomRef.current) {
      bottomSheetModalRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.45} pressBehavior="close" />
    ),
    []
  );

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableDismissOnClose={false}
      enableDynamicSizing={false}
      animationConfigs={{ duration: 220 }}
      backdropComponent={renderBackdrop}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
      topInset={topInset}
      onChange={handleSheetChange}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={8}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel="Close notifications"
        >
          <MaterialIcons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
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
    </BottomSheetModal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
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
