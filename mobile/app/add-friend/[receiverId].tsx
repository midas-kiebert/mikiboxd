import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, FriendsService } from "shared";

import TopBar from "@/components/layout/TopBar";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type RequestState = "loading" | "success" | "error";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getErrorDetail(error: unknown) {
  if (!(error instanceof ApiError)) return "Could not send friend request.";
  const body = error.body;
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as { detail?: unknown }).detail === "string"
  ) {
    return (body as { detail: string }).detail;
  }
  return `Could not send friend request (${error.status}).`;
}

export default function AddFriendScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { receiverId } = useLocalSearchParams<{ receiverId?: string | string[] }>();
  const [state, setState] = useState<RequestState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasAttemptedRef = useRef(false);

  const normalizedReceiverId = useMemo(() => {
    const value = Array.isArray(receiverId) ? receiverId[0] : receiverId;
    return value?.trim() ?? "";
  }, [receiverId]);

  const requestMutation = useMutation({
    mutationFn: (targetUserId: string) =>
      FriendsService.sendFriendRequest({
        receiverId: targetUserId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users", "receivedRequests"] }),
        queryClient.invalidateQueries({ queryKey: ["users", "sentRequests"] }),
        queryClient.invalidateQueries({ queryKey: ["users", "friends"] }),
      ]);
      setState("success");
    },
    onError: (error: unknown) => {
      setErrorMessage(getErrorDetail(error));
      setState("error");
    },
  });

  useEffect(() => {
    if (hasAttemptedRef.current) return;
    hasAttemptedRef.current = true;

    if (!UUID_PATTERN.test(normalizedReceiverId)) {
      setErrorMessage("Invalid invite link.");
      setState("error");
      return;
    }

    setState("loading");
    requestMutation.mutate(normalizedReceiverId);
  }, [normalizedReceiverId, requestMutation]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar title="Add Friend" showBackButton />
      <View style={styles.content}>
        {state === "loading" ? (
          <>
            <ActivityIndicator size="large" color={colors.tint} />
            <ThemedText style={styles.helperText}>Sending friend request...</ThemedText>
          </>
        ) : null}
        {state === "success" ? (
          <>
            <ThemedText style={styles.title}>Friend request sent</ThemedText>
            <ThemedText style={styles.helperText}>
              Your request is now waiting for acceptance.
            </ThemedText>
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.8}
              onPress={() => router.replace("/(tabs)/friends")}
            >
              <ThemedText style={styles.primaryButtonText}>Open Friends</ThemedText>
            </TouchableOpacity>
          </>
        ) : null}
        {state === "error" ? (
          <>
            <ThemedText style={styles.errorTitle}>Could not add friend</ThemedText>
            <ThemedText style={styles.helperText}>{errorMessage ?? "Try again later."}</ThemedText>
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.8}
              onPress={() => router.replace("/(tabs)/friends")}
            >
              <ThemedText style={styles.primaryButtonText}>Go to Friends</ThemedText>
            </TouchableOpacity>
          </>
        ) : null}
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
    title: {
      fontSize: 22,
      fontWeight: "700",
      color: colors.text,
      textAlign: "center",
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
