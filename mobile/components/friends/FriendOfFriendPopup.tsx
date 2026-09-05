/**
 * Lightweight popup for the "+" on a friend-of-friend badge — send a friend
 * request, or accept one they've already sent, without leaving the showtime
 * sheet. Same fade/scale `Modal` chrome as `components/ui/ConfirmDialog.tsx`
 * (per the app-wide "no native Alert dialogs" rule), but deliberately lighter
 * than `components/friends/NonFriendProfile.tsx` (which also offers
 * Block/Report) — those stay reachable from the person's full profile once
 * one exists; this popup does exactly what was asked: send or accept.
 */
import { useEffect, useState } from "react";
import { Animated, Easing, Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { UserWithFriendStatus } from "shared";

import InlineFriendRequestButtons from "@/components/friends/InlineFriendRequestButtons";
import { ThemedText } from "@/components/themed-text";
import { useFriendStatus } from "@/hooks/useFriendStatus";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

const FADE_IN_MS = 190;
const FADE_OUT_MS = 130;

type FriendOfFriendPopupProps = {
  user: UserWithFriendStatus | null;
  onClose: () => void;
  /**
   * Called right before navigating to the person's page, for a host that has
   * something of its own to close first — a sheet left open would sit over
   * the screen being pushed. Same convention as `FriendBadges`' `onNavigate`.
   */
  onNavigate?: () => void;
};

export default function FriendOfFriendPopup({
  user,
  onClose,
  onNavigate,
}: FriendOfFriendPopupProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const visible = user !== null;
  // Kept mounted (and the last user retained) one beat longer than `visible`
  // so the closing fade can play out without the content popping empty first.
  const [isMounted, setIsMounted] = useState(visible);
  const [lastUser, setLastUser] = useState(user);
  if (user && user !== lastUser) {
    setLastUser(user);
  }
  if (visible && !isMounted) {
    setIsMounted(true);
  }
  // Opacity and scale run on separate curves: the backdrop wants an even fade,
  // the card a spring that settles. One shared value could only do both badly.
  const opacity = useAnimatedValue(0);
  const scale = useAnimatedValue(0.9);

  useEffect(() => {
    if (visible) {
      opacity.setValue(0);
      scale.setValue(0.9);
      // Started on the next frame rather than in this commit: the native Modal
      // is still being put up, and an animation begun in the same tick loses
      // its first frames to that work and reads as a jump rather than a fade.
      const frame = requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: FADE_IN_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            damping: 18,
            stiffness: 240,
            mass: 0.9,
            useNativeDriver: true,
          }),
        ]).start();
      });
      return () => cancelAnimationFrame(frame);
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.96,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setIsMounted(false));
  }, [visible, opacity, scale]);

  if (!isMounted || !lastUser) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <MaterialIcons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {/* Its own component so the live-status query below only exists
              while there is someone to ask about — this outer one renders
              (and animates out) with no user at all. */}
          <PopupCardBody
            key={lastUser.id}
            user={lastUser}
            styles={styles}
            colors={colors}
            onClose={onClose}
            onNavigate={onNavigate}
          />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

type PopupCardBodyProps = {
  user: UserWithFriendStatus;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useThemeColors>;
  onClose: () => void;
  onNavigate?: () => void;
};

function PopupCardBody({
  user: seed,
  styles,
  colors,
  onClose,
  onNavigate,
}: PopupCardBodyProps) {
  // Same live status the buttons below read (one shared query key), so an
  // incoming request is stated in words and not just implied by an Accept
  // button. `acted` mirrors their optimistic override: a tap repaints this
  // line with the buttons rather than a beat later, when the request lands.
  const { data: liveUser } = useFriendStatus(seed);
  const [acted, setActed] = useState<"sent" | "cleared" | "friend" | null>(null);
  const router = useRouter();
  const goToUserPage = useSingleFireNavigation((id: string, userName: string) =>
    router.push({ pathname: "/friend-showtimes/[id]", params: { id, name: userName } })
  );
  const user = liveUser ?? seed;
  const name = user.display_name?.trim() || "This user";
  const avatarColors = getAvatarColors(user.id, colors);

  // Everything overlaying the page comes down before the push: this popup,
  // and whatever the host has open behind it. That route renders
  // `NonFriendProfile` for someone you aren't friends with, which is where
  // blocking and reporting live.
  const handleViewProfile = () => {
    onClose();
    onNavigate?.();
    goToUserPage(user.id, name);
  };

  const isFriend = acted === "friend" || (acted === null && user.is_friend);
  const hasSentYouARequest =
    acted === null && !user.is_friend && user.received_request;

  return (
    <>
      <View style={[styles.avatar, { backgroundColor: avatarColors.primary }]}>
        <ThemedText style={[styles.avatarText, { color: avatarColors.secondary }]}>
          {getAvatarInitial(name)}
        </ThemedText>
      </View>
      <ThemedText style={styles.name} numberOfLines={2}>
        {name}
      </ThemedText>
      {/* Deliberately not "a friend of a friend": the same badge also covers
          someone reachable through a shared invite, and naming the wrong
          connection is worse than naming none. Dropped once they're a friend,
          which the notice below then says instead. */}
      {isFriend ? null : (
        <ThemedText style={styles.hint}>
          You&apos;re not friends yet — you can see them on this showtime through someone
          you both know.
        </ThemedText>
      )}
      {hasSentYouARequest ? (
        <View style={styles.requestNotice}>
          <MaterialIcons name="person-add-alt" size={14} color={colors.tint} />
          <ThemedText style={styles.requestNoticeText}>
            {name} sent you a friend request.
          </ThemedText>
        </View>
      ) : isFriend ? (
        <View style={styles.requestNotice}>
          <MaterialIcons name="people" size={14} color={colors.tint} />
          <ThemedText style={styles.requestNoticeText}>You&apos;re now friends.</ThemedText>
        </View>
      ) : null}
      <View style={styles.actions}>
        <InlineFriendRequestButtons user={seed} onAction={setActed} />
      </View>
      <TouchableOpacity
        style={styles.profileLink}
        onPress={handleViewProfile}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`View ${name}'s profile`}
      >
        <ThemedText style={styles.profileLinkText}>View profile</ThemedText>
        <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
      </TouchableOpacity>
    </>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.28)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    card: {
      width: "100%",
      maxWidth: 300,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 18,
      alignItems: "center",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    closeButton: {
      position: "absolute",
      top: 10,
      right: 10,
      padding: 4,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 2,
    },
    avatarText: {
      fontSize: 22,
      fontWeight: "700",
      lineHeight: 26,
    },
    name: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
    hint: {
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
      color: colors.textSecondary,
    },
    requestNotice: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      marginTop: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: colors.surfaceMuted,
    },
    requestNoticeText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: colors.text,
      flexShrink: 1,
    },
    actions: { marginTop: 6 },
    profileLink: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      marginTop: 10,
      paddingVertical: 4,
    },
    profileLinkText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
  });
