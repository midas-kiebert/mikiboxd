import { useCallback, useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CinemaPublic, CityPublic } from "shared";
import { MeService, type MeSetCinemaSelectionsData } from "shared/client";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type CinemaFilterModalProps = {
  visible: boolean;
  onClose: () => void;
};

type CityGroup = {
  city: CityPublic;
  cinemas: CinemaPublic[];
};

const GROUPING_MINIMUM = 3;

function groupCinemas(cinemas: CinemaPublic[]) {
  const groupedByCity = new Map<number, CityGroup>();

  cinemas.forEach((cinema) => {
    const existing = groupedByCity.get(cinema.city.id);
    if (existing) {
      existing.cinemas.push(cinema);
      return;
    }
    groupedByCity.set(cinema.city.id, {
      city: cinema.city,
      cinemas: [cinema],
    });
  });

  const sortedGroups = Array.from(groupedByCity.values()).sort((a, b) =>
    a.city.name.localeCompare(b.city.name)
  );

  sortedGroups.forEach((group) => {
    group.cinemas.sort((a, b) => a.name.localeCompare(b.name));
  });

  const groupedCities: CityGroup[] = [];
  const ungrouped: CinemaPublic[] = [];

  sortedGroups.forEach((group) => {
    if (group.cinemas.length >= GROUPING_MINIMUM) {
      groupedCities.push(group);
    } else {
      ungrouped.push(...group.cinemas);
    }
  });

  ungrouped.sort((a, b) => {
    const cityCompare = a.city.name.localeCompare(b.city.name);
    if (cityCompare !== 0) return cityCompare;
    return a.name.localeCompare(b.name);
  });

  return { groupedCities, ungrouped };
}

const selectionsMatch = (left: number[], right: number[]) => {
  if (left.length !== right.length) return false;
  return left.every((id) => right.includes(id));
};

export default function CinemaFilterModal({ visible, onClose }: CinemaFilterModalProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const { data: cinemas } = useFetchCinemas();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();

  const savePreferredMutation = useMutation({
    mutationFn: (data: MeSetCinemaSelectionsData) => MeService.setCinemaSelections(data),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(["user", "cinema_selections"], variables.requestBody);
    },
  });

  useEffect(() => {
    if (sessionCinemaIds === undefined && preferredCinemaIds !== undefined) {
      setSessionCinemaIds(preferredCinemaIds);
    }
  }, [sessionCinemaIds, preferredCinemaIds, setSessionCinemaIds]);

  const selectedCinemas = sessionCinemaIds ?? preferredCinemaIds ?? [];
  const hasPreferredSelection = preferredCinemaIds !== undefined;
  const selectionMatchesPreferred = hasPreferredSelection
    ? selectionsMatch(selectedCinemas, preferredCinemaIds)
    : true;
  const preferenceStatus = hasPreferredSelection
    ? selectionMatchesPreferred
      ? "Matches your preferred cinemas."
      : "Not saved to your preferred cinemas."
    : "Loading preferred cinemas...";
  const isSavingPreferred = savePreferredMutation.isPending;
  const canSavePreferred = hasPreferredSelection && !isSavingPreferred && !selectionMatchesPreferred;
  const canUsePreferred = hasPreferredSelection && !isSavingPreferred && !selectionMatchesPreferred;

  const cinemaList = cinemas ?? [];

  const { groupedCities, ungrouped } = useMemo(
    () => groupCinemas(cinemaList),
    [cinemas]
  );

  const allCinemaIds = useMemo(
    () => cinemaList.map((cinema) => cinema.id),
    [cinemas]
  );

  const allSelected =
    allCinemaIds.length > 0 && allCinemaIds.every((id) => selectedCinemas.includes(id));

  const handleToggle = (cinemaId: number) => {
    const select = !selectedCinemas.includes(cinemaId);
    const next = select
      ? [...new Set([...selectedCinemas, cinemaId])]
      : selectedCinemas.filter((id) => id !== cinemaId);
    setSessionCinemaIds(next);
  };

  const handleToggleCity = (cityId: number) => {
    const cityCinemas = groupedCities.find((group) => group.city.id === cityId)?.cinemas || [];
    if (cityCinemas.length === 0) return;

    const isAllSelected = cityCinemas.every((cinema) => selectedCinemas.includes(cinema.id));
    const next = isAllSelected
      ? selectedCinemas.filter((id) => !cityCinemas.some((cinema) => cinema.id === id))
      : [...new Set([...selectedCinemas, ...cityCinemas.map((cinema) => cinema.id)])];
    setSessionCinemaIds(next);
  };

  const handleToggleAll = () => {
    const isAllSelected =
      allCinemaIds.length > 0 && allCinemaIds.every((id) => selectedCinemas.includes(id));
    const next = isAllSelected ? [] : [...new Set(allCinemaIds)];
    if (
      selectedCinemas.length !== next.length ||
      !selectedCinemas.every((id) => next.includes(id))
    ) {
      setSessionCinemaIds(next);
    }
  };

  const handleUsePreferred = useCallback(() => {
    if (preferredCinemaIds === undefined) return;
    setSessionCinemaIds(preferredCinemaIds);
  }, [preferredCinemaIds, setSessionCinemaIds]);

  const handleSavePreferred = useCallback(() => {
    if (preferredCinemaIds === undefined) return;
    savePreferredMutation.mutate({ requestBody: selectedCinemas });
  }, [preferredCinemaIds, savePreferredMutation, selectedCinemas]);

  const renderCinemaRow = (cinema: CinemaPublic, showCity = false) => {
    const selected = selectedCinemas.includes(cinema.id);
    return (
      <TouchableOpacity
        key={cinema.id}
        style={[styles.cinemaRow, selected && styles.cinemaRowSelected]}
        onPress={() => handleToggle(cinema.id)}
        activeOpacity={0.8}
      >
        <View style={styles.cinemaInfo}>
          <ThemedText
            numberOfLines={1}
            style={[styles.cinemaName, selected && styles.cinemaNameSelected]}
          >
            {cinema.name}
          </ThemedText>
          {showCity && (
            <ThemedText numberOfLines={1} style={styles.cinemaCity}>
              {cinema.city.name}
            </ThemedText>
          )}
        </View>
        <View style={[styles.checkbox, selected && styles.checkboxSelected]} />
      </TouchableOpacity>
    );
  };

  const isLoading =
    cinemas === undefined || (sessionCinemaIds === undefined && preferredCinemaIds === undefined);

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Cinemas</ThemedText>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.8}>
            <ThemedText style={styles.closeButtonText}>Close</ThemedText>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
            <ThemedText style={styles.loadingText}>Loading cinemas...</ThemedText>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceText}>
                <ThemedText style={styles.preferenceTitle}>Session selection</ThemedText>
                <ThemedText style={styles.preferenceSubtitle}>{preferenceStatus}</ThemedText>
              </View>
              <View style={styles.preferenceActions}>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    !canUsePreferred && styles.preferenceButtonDisabled,
                  ]}
                  onPress={handleUsePreferred}
                  activeOpacity={0.8}
                  disabled={!canUsePreferred}
                >
                  <ThemedText
                    style={[
                      styles.preferenceButtonText,
                      !canUsePreferred && styles.preferenceButtonTextDisabled,
                    ]}
                  >
                    Use preferred
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    styles.preferenceButtonPrimary,
                    !canSavePreferred && styles.preferenceButtonDisabled,
                  ]}
                  onPress={handleSavePreferred}
                  activeOpacity={0.8}
                  disabled={!canSavePreferred}
                >
                  <ThemedText
                    style={[
                      styles.preferenceButtonText,
                      styles.preferenceButtonTextPrimary,
                      !canSavePreferred && styles.preferenceButtonTextDisabled,
                    ]}
                  >
                    {isSavingPreferred ? "Saving..." : "Save as preferred"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>All cinemas</ThemedText>
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={handleToggleAll}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.toggleButtonText}>
                  {allSelected ? "Deselect All" : "Select All"}
                </ThemedText>
              </TouchableOpacity>
            </View>

            {groupedCities.map((group) => {
              const citySelected = group.cinemas.every((cinema) =>
                selectedCinemas.includes(cinema.id)
              );

              return (
                <View key={group.city.id} style={styles.citySection}>
                  <View style={styles.sectionHeader}>
                    <ThemedText style={styles.cityTitle}>{group.city.name}</ThemedText>
                    <TouchableOpacity
                      style={styles.toggleButton}
                      onPress={() => handleToggleCity(group.city.id)}
                      activeOpacity={0.8}
                    >
                      <ThemedText style={styles.toggleButtonText}>
                        {citySelected ? "Deselect All" : "Select All"}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cinemaList}>
                    {group.cinemas.map((cinema) => renderCinemaRow(cinema))}
                  </View>
                </View>
              );
            })}

            {ungrouped.length > 0 && (
              <View style={styles.citySection}>
                <View style={styles.sectionHeader}>
                  <ThemedText style={styles.cityTitle}>Other cinemas</ThemedText>
                </View>
                <View style={styles.cinemaList}>
                  {ungrouped.map((cinema) => renderCinemaRow(cinema, true))}
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
    },
    closeButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.pillBackground,
    },
    closeButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    content: {
      padding: 16,
      paddingBottom: 32,
      gap: 20,
    },
    preferenceRow: {
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      gap: 10,
    },
    preferenceText: {
      gap: 4,
    },
    preferenceTitle: {
      fontSize: 13,
      fontWeight: "700",
    },
    preferenceSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    preferenceActions: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    preferenceButton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    preferenceButtonPrimary: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    preferenceButtonDisabled: {
      opacity: 0.5,
    },
    preferenceButtonText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    preferenceButtonTextPrimary: {
      color: colors.background,
    },
    preferenceButtonTextDisabled: {
      color: colors.textSecondary,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 20,
    },
    loadingText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
    },
    cityTitle: {
      fontSize: 15,
      fontWeight: "700",
    },
    toggleButton: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    toggleButtonText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    citySection: {
      gap: 10,
    },
    cinemaList: {
      gap: 10,
    },
    cinemaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    cinemaRowSelected: {
      borderColor: colors.tint,
      backgroundColor: colors.pillBackground,
    },
    cinemaInfo: {
      flex: 1,
      marginRight: 12,
      gap: 2,
    },
    cinemaName: {
      fontSize: 14,
      fontWeight: "600",
    },
    cinemaNameSelected: {
      color: colors.text,
    },
    cinemaCity: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    checkbox: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.textSecondary,
      backgroundColor: "transparent",
    },
    checkboxSelected: {
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
  });
