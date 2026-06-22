import { useMemo } from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { VisibilityMode } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getVisibilityModeMeta, VISIBILITY_MODE_ORDER } from "./visibility-mode";

type VisibilityModePickerProps = {
  visible: boolean;
  selectedMode: VisibilityMode | null;
  onSelect: (mode: VisibilityMode) => void;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  dismissable?: boolean;
};

export default function VisibilityModePicker({
  visible,
  selectedMode,
  onSelect,
  onClose,
  title = "Who can see your status?",
  subtitle,
  dismissable = true,
}: VisibilityModePickerProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissable ? onClose : undefined}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={dismissable ? onClose : undefined}
          disabled={!dismissable}
        />
        <View style={styles.card}>
          <ThemedText style={styles.title}>{title}</ThemedText>
          {subtitle ? <ThemedText style={styles.subtitle}>{subtitle}</ThemedText> : null}
          <View style={styles.options}>
            {VISIBILITY_MODE_ORDER.map((mode) => {
              const meta = getVisibilityModeMeta(mode, colors);
              const isSelected = mode === selectedMode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.option,
                    isSelected && { borderColor: meta.color, backgroundColor: colors.pillBackground },
                  ]}
                  onPress={() => onSelect(mode)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.iconWrap, { backgroundColor: meta.color }]}>
                    <MaterialIcons name={meta.icon} size={18} color={colors.pillActiveText} />
                  </View>
                  <View style={styles.optionText}>
                    <ThemedText style={styles.optionLabel}>{meta.label}</ThemedText>
                    <ThemedText style={styles.optionDescription}>{meta.description}</ThemedText>
                  </View>
                  {isSelected ? (
                    <MaterialIcons name="check-circle" size={20} color={meta.color} />
                  ) : (
                    <MaterialIcons
                      name="radio-button-unchecked"
                      size={20}
                      color={colors.textSecondary}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.35)",
      justifyContent: "center",
      paddingHorizontal: 22,
    },
    card: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 10,
    },
    title: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    options: {
      gap: 8,
      marginTop: 2,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    iconWrap: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },
    optionText: {
      flex: 1,
      gap: 2,
    },
    optionLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    optionDescription: {
      fontSize: 12,
      color: colors.textSecondary,
    },
  });
