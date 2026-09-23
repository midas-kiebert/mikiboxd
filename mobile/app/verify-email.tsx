/**
 * Where the "Confirm your email" link lands in the app.
 *
 * The mailed link is `https://mikino.nl/verify-email?token=…`, a path the app
 * claims through its universal/app links, so on a phone with the app installed
 * it opens here instead of the browser. The website has the same page for
 * everyone else (`frontend/src/routes/verify-email.tsx`); keep their wording in
 * step.
 *
 * The token is the proof, not the session, so this works signed in, as a guest,
 * or signed out — and the route guard leaves it alone in all three. What the
 * button leads to afterwards is what differs.
 */
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, MeService, UsersService } from "shared";

import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import { ThemedText } from "@/components/themed-text";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useAuthStatus } from "@/utils/auth-session";

type Tone = "working" | "success" | "error";

export default function VerifyEmailScreen() {
  // Read flow: route state and data hooks first, then derived state and
  // handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const authStatus = useAuthStatus();
  const isSignedIn = authStatus === "signed-in";
  const user = useCurrentUser();
  const [hasResent, setHasResent] = useState(false);

  // A query rather than a mutation so the request is made once per token, even
  // if the screen mounts twice (a cold start that also delivers the URL as an
  // event). Confirming is idempotent on the backend either way.
  const confirmation = useQuery({
    queryKey: ["verifyEmail", token],
    queryFn: () => UsersService.verifyEmail({ requestBody: { token: token ?? "" } }),
    enabled: Boolean(token),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // `email_verified` just changed under the cached user, and the "Confirm your
  // email" tip (and the email notification switches) read it.
  useEffect(() => {
    if (confirmation.isSuccess && isSignedIn) {
      void queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    }
  }, [confirmation.isSuccess, isSignedIn, queryClient]);

  const isRejected =
    !token || (confirmation.error instanceof ApiError && confirmation.error.status === 400);
  // A dead link on an account that is confirmed anyway (an older link, opened
  // after a newer one) has still got the user what they came for.
  const isConfirmed = confirmation.isSuccess || (isRejected && user?.email_verified === true);
  const isOffline = !isConfirmed && !isRejected && confirmation.isError;

  // Back to wherever the link interrupted, if it opened over something;
  // otherwise to the screen this account would start on.
  const leave = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(authStatus === "signed-out" ? "/login" : "/(tabs)");
  };

  // A new link needs an account to send it to; once signed in, the "Confirm
  // your email" tip offers one.
  const goToLogin = () => router.replace("/login");

  const handleResend = () => {
    // Painted before the request goes out: the backend answers the same
    // either way, so there is nothing to wait for.
    setHasResent(true);
    MeService.resendEmailVerification().catch(() => {});
  };

  const tone: Tone = isConfirmed ? "success" : isRejected || isOffline ? "error" : "working";
  const toneColors = {
    working: { background: colors.surfaceMuted, foreground: colors.tint },
    success: { background: colors.green.primary, foreground: colors.green.secondary },
    error: { background: colors.red.primary, foreground: colors.red.secondary },
  }[tone];

  let icon: keyof typeof MaterialIcons.glyphMap = "mark-email-read";
  let title = "Confirming your email";
  let message = "One moment.";
  if (isConfirmed) {
    title = "Email confirmed";
    message = "Thanks. We can now email you, and you can reset your password if you ever forget it.";
  } else if (isRejected) {
    icon = "error-outline";
    title = "This link didn't work";
    message = "It may have expired, or been cut short on its way here. A new one takes a second.";
  } else if (isOffline) {
    icon = "wifi-off";
    title = "Couldn't confirm just now";
    message = "Your link is fine; we couldn't reach MiKiNO to check it.";
  }

  const leaveLabel =
    authStatus === "signed-out" ? "Log in" : isSignedIn ? "Continue" : "Browse screenings";

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.iconTile, { backgroundColor: toneColors.background }]}>
            {tone === "working" ? (
              <ActivityIndicator color={toneColors.foreground} />
            ) : (
              <MaterialIcons name={icon} size={30} color={toneColors.foreground} />
            )}
          </View>
          <ThemedText style={styles.title}>{title}</ThemedText>
          <ThemedText style={styles.message}>{message}</ThemedText>
        </View>

        {tone === "working" ? null : (
          <View style={styles.card}>
            {isOffline ? (
              <AuthPrimaryButton
                label="Try again"
                onPress={() => void confirmation.refetch()}
                isBusy={confirmation.isFetching}
              />
            ) : isRejected && isSignedIn ? (
              <>
                {user?.email ? <ThemedText style={styles.address}>{user.email}</ThemedText> : null}
                <AuthPrimaryButton
                  label={hasResent ? "Link sent" : "Send a new link"}
                  onPress={handleResend}
                  isDisabled={hasResent}
                />
                <ThemedText style={styles.note}>
                  {hasResent
                    ? "Check your inbox, and your spam folder."
                    : "Wrong address? You can change it in Settings."}
                </ThemedText>
              </>
            ) : isRejected ? (
              <>
                <AuthPrimaryButton label="Log in to get a new link" onPress={goToLogin} />
                <ThemedText style={styles.note}>
                  {"Once you're in, we'll offer to send one."}
                </ThemedText>
              </>
            ) : (
              <AuthPrimaryButton label={leaveLabel} onPress={leave} />
            )}
          </View>
        )}

        {/* The way out wherever the button is not already one. Signed out, a
            dead link's button is the only way on: without an account there is
            nothing behind this screen but the login one. */}
        {tone === "working" || isConfirmed || (isRejected && authStatus === "signed-out") ? null : (
          <TouchableOpacity
            onPress={leave}
            activeOpacity={0.7}
            accessibilityRole="button"
            hitSlop={6}
          >
            <ThemedText style={styles.link}>{isSignedIn ? "Not now" : leaveLabel}</ThemedText>
          </TouchableOpacity>
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
    // Same frame as `AuthScreenShell`: centred, 24pt gutters, so arriving here
    // from a link reads as the same family of screen as signing in.
    content: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingVertical: 18,
      gap: 16,
    },
    header: {
      alignItems: "center",
      gap: 6,
    },
    iconTile: {
      width: 60,
      height: 60,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    title: {
      fontSize: 24,
      lineHeight: 30,
      fontWeight: "800",
      textAlign: "center",
      color: colors.text,
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      color: colors.textSecondary,
    },
    card: {
      gap: 12,
      padding: 20,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
    },
    address: {
      fontSize: 15,
      // Explicit: the default type's lineHeight is 24 and survives a fontSize
      // override.
      lineHeight: 20,
      fontWeight: "700",
      textAlign: "center",
      color: colors.text,
    },
    note: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      color: colors.textSecondary,
    },
    link: {
      fontSize: 14,
      fontWeight: "700",
      textAlign: "center",
      color: colors.tint,
    },
  });
