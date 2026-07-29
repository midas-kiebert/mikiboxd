/**
 * "Watchlisted" / "Watched" popup: the friends whose Letterboxd account has this
 * relationship with the film. Opened from the tiny icon markers on the showtime
 * sheet and the movie page, which is why the heading only names the relationship
 * — that is the information the icon left out.
 *
 * Static by default (the movie page has no single showtime to invite anyone to);
 * pass `invite` to give each row the showtime sheet's invite button. The
 * "watched" list stays static even then — those friends have already seen the
 * film, so inviting them to a screening of it isn't the point of that list.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import type { UserPublic } from "shared";

import FriendListRow from "@/components/friends/FriendListRow";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { getFriendWatchKindMeta, type FriendWatchKind } from "@/components/friends/friend-watch-kind";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

// RN's built-in Modal `animationType="fade"` has a fixed, slow native duration
// that can't be tuned via props, so the fade is driven here instead.
const FADE_IN_MS = 120;
const FADE_OUT_MS = 120;

/** Per-friend invite state, resolved by the sheet that owns the ping data. */
export type FriendWatchInviteState = {
  /** "Going" / "Interested" — replaces the invite button when set. */
  statusLabel: string | null;
  invited: boolean;
  disabled: boolean;
};

type FriendWatchListModalProps = {
  /** The open list, or null when the popup is closed. */
  kind: FriendWatchKind | null;
  friends: UserPublic[];
  onClose: () => void;
  invite?: {
    getState: (friendId: string) => FriendWatchInviteState;
    onInvite: (friendId: string) => void;
  };
  /**
   * Called (in addition to `onClose`) right before a row navigates to that
   * friend's page. This popup can itself be nested inside a bigger sheet (the
   * showtime sheet's watch markers); `onClose` only dismisses the popup, so a
   * caller in that position passes its own outer close here to take the whole
   * sheet down too — leaving it open behind the new screen would look broken.
   * The movie page, which isn't inside anything, has no need to pass this.
   */
  onNavigate?: () => void;
};

const getFriendName = (friend: UserPublic) => friend.display_name?.trim() || "Friend";

export default function FriendWatchListModal({
  kind,
  friends,
  onClose,
  invite,
  onNavigate,
}: FriendWatchListModalProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const goToUserPage = useSingleFireNavigation((friendId: string, name: string) =>
    router.push({ pathname: "/friend-showtimes/[id]", params: { id: friendId, name } })
  );
  const anim = useRef(new Animated.Value(0)).current;
  const scale = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [anim]
  );
  // Kind *and* friends are kept one beat longer than the props so the closing
  // fade plays out on the list that was open. Callers derive `friends` from
  // `kind`, so on close the incoming list is already the other relationship's —
  // rendering it would flash the wrong list through the fade. Held in a ref and
  // written during render (not in an effect) so the modal's first commit already
  // has its content — mounting a frame late let the fade run out before the
  // native modal window appeared, which made the popup pop in instead.
  const lastOpen = useRef<{ kind: FriendWatchKind; friends: UserPublic[] } | null>(null);
  if (kind) lastOpen.current = { kind, friends };
  const [isMounted, setIsMounted] = useState(kind !== null);
  if (kind && !isMounted) setIsMounted(true);

  // Fade+scale — keyed on open/closed alone so a live friends update mid-view (an
  // invite landing, say) doesn't restart the animation. Layout effect so the
  // animation starts on the same commit that mounts the modal.
  useLayoutEffect(() => {
    if (kind) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: FADE_IN_MS,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(() => setIsMounted(false));
  }, [kind, anim]);

  // Render/output using the state and derived values prepared above.
  const rendered = lastOpen.current;
  if (!isMounted || !rendered) return null;

  const renderedFriends = rendered.friends;
  const meta = getFriendWatchKindMeta(rendered.kind, colors);
  // Keyed off the held kind, not the prop: on close the prop is already null, so
  // deciding this at the call site would flash invite buttons through the fade.
  const rowInvite = rendered.kind === "watched" ? undefined : invite;
  const countLabel = `${renderedFriends.length} friend${renderedFriends.length === 1 ? "" : "s"}`;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={styles.header}>
            <View style={[styles.headerIcon, { backgroundColor: meta.background }]}>
              <MaterialIcons name={meta.icon} size={16} color={meta.accent} />
            </View>
            <View style={styles.headerText}>
              <ThemedText style={styles.title}>{meta.title}</ThemedText>
              <ThemedText style={styles.subtitle}>{countLabel}</ThemedText>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.7}>
              <MaterialIcons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {renderedFriends.map((friend) => {
              const inviteState = rowInvite?.getState(friend.id);
              const name = getFriendName(friend);
              return (
                <FriendListRow
                  key={friend.id}
                  userId={friend.id}
                  name={name}
                  mode={rowInvite ? "invite" : "display"}
                  statusLabel={inviteState?.statusLabel ?? null}
                  invited={inviteState?.invited ?? false}
                  disabled={inviteState?.disabled ?? false}
                  onInvite={rowInvite ? () => rowInvite.onInvite(friend.id) : undefined}
                  onPress={() => {
                    onClose();
                    onNavigate?.();
                    goToUserPage(friend.id, name);
                  }}
                />
              );
            })}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
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
      maxWidth: 380,
      maxHeight: "70%",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      padding: 14,
      gap: 12,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 9,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    headerIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },
    headerText: { flex: 1, minWidth: 0 },
    title: { fontSize: 16, fontWeight: "700", color: colors.text },
    subtitle: { fontSize: 12, color: colors.textSecondary },
    scroll: { flexGrow: 0 },
    list: { gap: 6, paddingBottom: 2 },
  });
