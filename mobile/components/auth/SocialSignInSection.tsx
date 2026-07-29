/**
 * "Continue with Apple / Google", plus the divider that separates them from the
 * email form below.
 *
 * Shared by the log in and sign up screens, which used to carry a verbatim copy
 * of both handlers each — two chances for the two most important buttons in the
 * app to start behaving differently from one another. The only thing that
 * actually differs is the wording, since the backend creates the account on
 * first use either way.
 *
 * Both buttons commit to a busy state the instant they are tapped: a provider
 * sign-in is a native sheet plus two round trips, and the previous version gave
 * no sign at all that the tap had registered.
 */
import { useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import type { AuthHook } from "shared/types";

import GoogleMark from "@/components/auth/GoogleMark";
import { ThemedText } from "@/components/themed-text";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeColors } from "@/hooks/use-theme-color";
import { markSignedIn } from "@/utils/auth-session";
import { completeLogin } from "@/utils/complete-login";
import { getGoogleSignin, isGoogleSignInAvailable } from "@/utils/google-signin";
import { markIntroPending } from "@/utils/intro";
import { markPasswordRemovedForProvider } from "@/utils/sign-in-notice";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { markUsernameRequired } from "@/utils/username-gate";

type SocialProvider = "apple" | "google";

type SocialSignInSectionProps = {
  /** Only changes the wording — either button will create the account. */
  mode: "sign-in" | "sign-up";
  socialLoginMutation: AuthHook["socialLoginMutation"];
  resetError: () => void;
  /** The screen's own email form is working; nothing else should be tappable. */
  isDisabled?: boolean;
  /** Lets the screen disable its email form while a provider sheet is open. */
  onBusyChange?: (isBusy: boolean) => void;
};

/** Also the Google button's height — the two read as a pair, so they match. */
const PROVIDER_BUTTON_HEIGHT = 46;

export default function SocialSignInSection({
  mode,
  socialLoginMutation,
  resetError,
  isDisabled = false,
  onBusyChange,
}: SocialSignInSectionProps) {
  // Read flow: local state and derived values first, then the handlers, then JSX.
  const router = useRouter();
  const colors = useThemeColors();
  const colorScheme = useColorScheme();
  const styles = createStyles(colors);

  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);

  // Apple's button is an iOS-only native view, and Google's module is missing
  // from Expo Go entirely — so on a dev machine the section could be empty and
  // there was no way to look at the layout without a real build. In __DEV__ the
  // buttons are drawn anyway (see `isAppleUsable` / `isGoogleUsable` for which
  // ones can actually sign anyone in).
  const isAppleUsable = Platform.OS === "ios";
  const isGoogleUsable = isGoogleSignInAvailable;
  const hasAppleButton = isAppleUsable || __DEV__;
  const hasGoogleButton = isGoogleUsable || __DEV__;
  const hasUnusableButton = (hasAppleButton && !isAppleUsable) || (hasGoogleButton && !isGoogleUsable);
  const isBusy = pendingProvider !== null;
  const isBlocked = isBusy || isDisabled;

  const setBusy = (provider: SocialProvider | null) => {
    setPendingProvider(provider);
    onBusyChange?.(provider !== null);
  };

  // A social sign-in the backend reports as new has no username yet, so it
  // detours through /pick-username instead of straight into the app. That is a
  // protected route, so the session has to be announced before we navigate to
  // it — otherwise the root layout's guard bounces us back to /login. And the
  // gate is raised before the session, so the guard cannot see a signed-in user
  // on the login screen and send it to the tabs in the render between the two.
  const finishSocialLogin = async (
    provider: SocialProvider,
    result: { needsUsername: boolean; passwordRemoved: boolean },
    suggestion: string | undefined
  ) => {
    // Linking a provider to an account whose address was never confirmed drops
    // that account's password. Raised before the navigation, so the notice is
    // already pending wherever the user lands.
    if (result.passwordRemoved) {
      markPasswordRemovedForProvider(provider);
    }
    if (result.needsUsername) {
      markUsernameRequired();
      markIntroPending();
      markSignedIn();
      router.replace({ pathname: "/pick-username", params: { suggestion: suggestion ?? "" } });
      return;
    }
    await completeLogin(router);
  };

  const handleAppleSignIn = async () => {
    if (isBlocked) return;
    if (!isAppleUsable) {
      console.log("[dev] Apple sign-in needs an iOS build; this button is a preview.");
      return;
    }
    triggerSelectionHaptic();
    resetError();
    setBusy("apple");
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) return;
      // fullName is only populated on the very first authorization for a
      // given app, so this is only usable as a pick-username suggestion
      // on account creation.
      const displayName = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(" ")
        : undefined;
      const result = await socialLoginMutation.mutateAsync({
        provider: "apple",
        token: credential.identityToken,
      });
      await finishSocialLogin("apple", result, displayName);
    } catch (appleError: unknown) {
      if ((appleError as { code?: string })?.code === "ERR_REQUEST_CANCELED") return;
      console.log("Apple sign-in error", appleError);
      // Error handled by useAuth for API failures; silently ignored otherwise.
    } finally {
      setBusy(null);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isBlocked) return;
    if (!isGoogleUsable) {
      console.log("[dev] Google sign-in needs a development build; this button is a preview.");
      return;
    }
    triggerSelectionHaptic();
    resetError();
    setBusy("google");
    try {
      const { GoogleSignin } = getGoogleSignin();
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (response.type !== "success" || !response.data.idToken) return;
      const result = await socialLoginMutation.mutateAsync({
        provider: "google",
        token: response.data.idToken,
      });
      await finishSocialLogin("google", result, response.data.user.name ?? undefined);
    } catch (googleError: unknown) {
      const { statusCodes } = getGoogleSignin();
      const code = (googleError as { code?: string })?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED) return;
      console.log("Google sign-in error", googleError);
      // Error handled by useAuth for API failures; silently ignored otherwise.
    } finally {
      setBusy(null);
    }
  };

  // Render/output using the state and handlers prepared above.
  if (!hasAppleButton && !hasGoogleButton) return null;

  return (
    <View style={styles.container}>
      {hasAppleButton && !isAppleUsable ? (
        // Preview only: Apple's button is a native iOS view, so off iOS there is
        // nothing to render but a look-alike.
        <TouchableOpacity
          style={[styles.applePlaceholder, styles.buttonBlocked]}
          onPress={handleAppleSignIn}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="apple" size={20} color="#ffffff" />
          <ThemedText style={styles.applePlaceholderText}>
            {mode === "sign-up" ? "Sign up with Apple" : "Sign in with Apple"}
          </ThemedText>
        </TouchableOpacity>
      ) : null}

      {hasAppleButton && isAppleUsable ? (
        // Apple's own button cannot render a busy state, so the wrapper carries
        // it: dimmed while it works, with the spinner over the top.
        <View style={[styles.appleWrapper, isBlocked && styles.buttonBlocked]}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              mode === "sign-up"
                ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
            }
            // A black button on the dark theme's near-black background is a
            // rectangle you can only find by its text.
            buttonStyle={
              colorScheme === "dark"
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={12}
            style={styles.appleButton}
            onPress={handleAppleSignIn}
          />
          {pendingProvider === "apple" ? (
            <View style={styles.appleSpinner} pointerEvents="none">
              <ActivityIndicator
                size="small"
                color={colorScheme === "dark" ? "#000000" : "#ffffff"}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {hasGoogleButton ? (
        <TouchableOpacity
          style={[styles.googleButton, (isBlocked || !isGoogleUsable) && styles.buttonBlocked]}
          onPress={handleGoogleSignIn}
          disabled={isBlocked}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: isBlocked, busy: pendingProvider === "google" }}
        >
          {pendingProvider === "google" ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <>
              <GoogleMark size={18} />
              <ThemedText style={styles.googleButtonText}>Continue with Google</ThemedText>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      {hasUnusableButton ? (
        <ThemedText style={styles.devNote}>
          [dev] Greyed-out providers are previews — they need a real build to sign in.
        </ThemedText>
      ) : null}

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <ThemedText style={styles.dividerText}>
          {mode === "sign-up" ? "or sign up with email" : "or continue with email"}
        </ThemedText>
        <View style={styles.dividerLine} />
      </View>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      gap: 8,
    },
    appleWrapper: {
      justifyContent: "center",
    },
    appleButton: {
      height: PROVIDER_BUTTON_HEIGHT,
    },
    // Matches Apple's own button closely enough to judge the layout by.
    applePlaceholder: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: PROVIDER_BUTTON_HEIGHT,
      borderRadius: 12,
      backgroundColor: "#000000",
    },
    applePlaceholderText: {
      color: "#ffffff",
      fontSize: 16,
      fontWeight: "600",
    },
    devNote: {
      fontSize: 11,
      lineHeight: 15,
      textAlign: "center",
      color: colors.textSecondary,
    },
    appleSpinner: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
    },
    googleButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      height: PROVIDER_BUTTON_HEIGHT,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
    },
    buttonBlocked: {
      opacity: 0.55,
    },
    googleButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "600",
    },
    dividerRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingTop: 4,
      // Breathing room before the email form that follows this section.
      paddingBottom: 10,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.cardBorder,
    },
    dividerText: {
      marginHorizontal: 10,
      color: colors.textSecondary,
      fontSize: 13,
    },
  });
