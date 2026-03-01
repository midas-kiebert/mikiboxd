import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OpenAPI } from "shared";
import { storage } from "shared/storage";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type RequestState = "loading" | "error";

type ErrorBody = {
  detail?: unknown;
};

function getErrorDetail(body: unknown, status: number) {
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as ErrorBody).detail === "string"
  ) {
    return (body as ErrorBody).detail as string;
  }
  return `Could not process ping link (${status}).`;
}

export default function PingLinkScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showtimeId, sender } = useLocalSearchParams<{
    showtimeId?: string | string[];
    sender?: string | string[];
  }>();
  const [state, setState] = useState<RequestState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasAttemptedRef = useRef(false);

  const normalizedShowtimeId = useMemo(() => {
    const value = Array.isArray(showtimeId) ? showtimeId[0] : showtimeId;
    const parsed = Number.parseInt(value?.trim() ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [showtimeId]);

  const normalizedSender = useMemo(() => {
    const value = Array.isArray(sender) ? sender[0] : sender;
    return value?.trim() ?? "";
  }, [sender]);

  useEffect(() => {
    if (hasAttemptedRef.current) return;
    hasAttemptedRef.current = true;

    if (normalizedShowtimeId === null || normalizedSender.length === 0) {
      setErrorMessage("Invalid ping link.");
      setState("error");
      return;
    }

    const handleLink = async () => {
      try {
        const token = await storage.getItem("access_token");
        if (!token) {
          throw new Error("You need to log in before opening this ping link.");
        }

        const response = await fetch(
          `${OpenAPI.BASE}/api/v1/showtimes/${normalizedShowtimeId}/ping-link/${encodeURIComponent(
            normalizedSender
          )}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          }
        );

        const body = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error(getErrorDetail(body, response.status));
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] }),
          queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] }),
        ]);
        router.replace("/(tabs)/pings");
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Could not process ping link.";
        setErrorMessage(message);
        setState("error");
      }
    };

    void handleLink();
  }, [normalizedSender, normalizedShowtimeId, queryClient, router]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar title="Ping Link" showBackButton />
      <View style={styles.content}>
        {state === "loading" ? (
          <>
            <ActivityIndicator size="large" color={colors.tint} />
            <ThemedText style={styles.helperText}>Opening ping...</ThemedText>
          </>
        ) : (
          <>
            <ThemedText style={styles.errorTitle}>Could not open ping</ThemedText>
            <ThemedText style={styles.helperText}>{errorMessage ?? "Try again later."}</ThemedText>
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.8}
              onPress={() => router.replace("/(tabs)/pings")}
            >
              <ThemedText style={styles.primaryButtonText}>Open Pings</ThemedText>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    errorTitle: {
      fontSize: 22,
      fontWeight: "700",
      color: colors.red.secondary,
      textAlign: "center",
    },
    helperText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
    },
    primaryButton: {
      marginTop: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.tint,
      paddingVertical: 11,
      paddingHorizontal: 16,
      minWidth: 170,
      alignItems: "center",
    },
    primaryButtonText: {
      color: colors.pillActiveText,
      fontSize: 14,
      fontWeight: "700",
    },
  });
