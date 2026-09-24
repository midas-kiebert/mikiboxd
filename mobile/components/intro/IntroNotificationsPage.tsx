/**
 * Intro page — how do you want to be notified?
 *
 * Asked as a question with two answers, push or email, rather than as a bare
 * permission request: people deny a cold system prompt out of habit, but most
 * of them do want to hear when a friend invites them. Opting out is possible
 * but deliberately takes a few steps, each one saying what it costs:
 *
 *  - `ask`: push (recommended) or email, with "I don't want notifications"
 *    as the quiet way out.
 *  - `push-refused`: they picked push, then refused the system prompt. Not
 *    taken as an answer — they can try again (with the exact steps for system
 *    settings once the OS has stopped asking), switch to email, or opt out.
 *  - `confirm-none`: "Are you sure?" — and the offer of notifications for
 *    invites only, as push or email, before everything is switched off.
 *
 * Push is only ever saved once this device has a push token, so the choice
 * never claims a delivery that cannot happen. Email can be chosen before the
 * address is confirmed; nothing is sent until it is, and the verify-email tip
 * sees to that soon enough.
 *
 * Also the whole of the notifications-only intro, which an account that has
 * never been asked on the app (made on the website, say) gets on its first
 * sign-in here. Answering it in any way records that on the account.
 */
import { type ReactNode, useCallback, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQueryClient } from "@tanstack/react-query";
import { type NotificationChannel, MeService, type UserUpdate } from "shared/client";
import { buildAllOffUpdate, buildChannelForAllUpdate } from "shared/notifications/preferences";

import IntroPageShell from "@/components/intro/IntroPageShell";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePushPermissionFlow } from "@/hooks/usePushPermissionFlow";
import { markNotificationsAnswered } from "@/utils/intro";
import { triggerSelectionHaptic } from "@/utils/long-press";

type Step = "ask" | "push-refused" | "confirm-none";
/** Everything the user hears about, or only invites (after "are you sure?"). */
type Scope = "all" | "invites";

/** What the notifications are for, in the order the user meets them. */
const NOTIFICATION_EXAMPLES: readonly {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  detail: string;
}[] = [
  { icon: "mail", label: "Invites", detail: "A friend asks you along to a screening." },
  { icon: "person-add", label: "Friend requests", detail: "Someone wants to follow along." },
  { icon: "groups", label: "Friend activity", detail: "A friend is going to a film you want to see." },
  { icon: "event-busy", label: "Seat availability", detail: "A screening you want is nearly sold out." },
];

const buildPatch = (scope: Scope, channel: NotificationChannel | null): UserUpdate => {
  if (channel === null) return { ...buildAllOffUpdate(), app_notifications_prompted: true };
  if (scope === "all") {
    return { ...buildChannelForAllUpdate(channel), app_notifications_prompted: true };
  }
  return {
    ...buildAllOffUpdate(),
    notify_on_showtime_ping: true,
    notify_channel_showtime_ping: channel,
    app_notifications_prompted: true,
  };
};

export default function IntroNotificationsPage({ onDone }: { onDone: () => void }) {
  // Read flow: state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [step, setStep] = useState<Step>("ask");
  const [scope, setScope] = useState<Scope>("all");
  // Read by the grant callback, which can fire before the render that
  // follows `setScope` — straight from the prompt in the same tick.
  const scopeRef = useRef<Scope>("all");
  const [isSaving, setIsSaving] = useState(false);

  const finish = useCallback(
    async (channel: NotificationChannel | null, forScope: Scope) => {
      setIsSaving(true);
      try {
        const updated = await MeService.updateUserMe({
          requestBody: buildPatch(forScope, channel),
        });
        queryClient.setQueryData(["currentUser"], updated);
      } catch (error) {
        // Not a reason to hold the user on this page: the next launch simply
        // asks again, since the account was never marked as asked.
        console.error("Error saving the intro's notification choice:", error);
      } finally {
        setIsSaving(false);
      }
      markNotificationsAnswered();
      onDone();
    },
    [onDone, queryClient]
  );

  const push = usePushPermissionFlow({
    onGranted: () => void finish("push", scopeRef.current),
    // The page answers a fresh refusal itself (the `push-refused` step);
    // the settings steps are for "try again" and an OS that no longer asks.
    showHelpOnDenial: false,
    helpAlternative: {
      label: scope === "all" ? "Email me instead" : "Email me about invites instead",
      onPress: () => void finish("email", scopeRef.current),
    },
  });

  const choosePush = useCallback(
    async (forScope: Scope) => {
      scopeRef.current = forScope;
      setScope(forScope);
      const granted = await push.request();
      // Granted finishes through `onGranted`. A refusal the OS will still ask
      // about again lands on the page's own choices; one it will not has
      // already opened the settings steps, over whichever step this is.
      if (!granted) setStep("push-refused");
    },
    [push]
  );

  const goTo = (next: Step) => {
    triggerSelectionHaptic();
    setStep(next);
  };

  const emailNote = currentUser?.email_verified
    ? `Sent to ${currentUser.email}.`
    : "We'll start as soon as you've confirmed your email address.";

  // Render/output using the state and handlers prepared above.
  const renderEmailButton = (label: string, forScope: Scope) => (
    <TouchableOpacity
      style={[styles.emailButton, isSaving && styles.disabled]}
      onPress={() => {
        triggerSelectionHaptic();
        void finish("email", forScope);
      }}
      disabled={isSaving || push.isRequesting}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <MaterialIcons name="mail-outline" size={18} color={colors.text} />
      <View style={styles.emailButtonText}>
        <ThemedText style={styles.emailButtonLabel}>{label}</ThemedText>
        <ThemedText style={styles.emailButtonNote}>{emailNote}</ThemedText>
      </View>
    </TouchableOpacity>
  );

  let page: ReactNode;
  if (step === "confirm-none") {
    page = (
      <IntroPageShell
        icon="notifications-off"
        title="Are you sure you don't want any notifications?"
        message="You'll miss it when a friend invites you to a screening. How about notifications for invites only?"
        primaryLabel="Push notifications for invites"
        onPrimary={() => void choosePush("invites")}
        isPrimaryBusy={push.isRequesting || isSaving}
        secondaryLabel="No, turn all notifications off"
        onSecondary={() => void finish(null, "all")}
      >
        {renderEmailButton("Email me about invites", "invites")}
      </IntroPageShell>
    );
  } else if (step === "push-refused") {
    page = (
      <IntroPageShell
        icon="notifications-paused"
        title="Notifications weren't allowed"
        message={
          scope === "all"
            ? "You chose push notifications, but your phone is set not to show them — so invites from friends won't reach you."
            : "You chose push notifications for invites, but your phone is set not to show them."
        }
        primaryLabel="Turn on push notifications"
        onPrimary={() => void choosePush(scope)}
        isPrimaryBusy={push.isRequesting || isSaving}
        secondaryLabel={scope === "all" ? "I don't want notifications" : "No, turn all notifications off"}
        onSecondary={scope === "all" ? () => goTo("confirm-none") : () => void finish(null, "all")}
      >
        {renderEmailButton(
          scope === "all" ? "Email me instead" : "Email me about invites instead",
          scope
        )}
      </IntroPageShell>
    );
  } else {
    page = (
      <IntroPageShell
        icon="notifications"
        title="How do you want to be notified when friends invite you?"
        message="The same goes for friend requests, friends' plans and screenings selling out. You can fine-tune it all in Settings."
        primaryLabel="Push notifications"
        onPrimary={() => void choosePush("all")}
        isPrimaryBusy={push.isRequesting || isSaving}
        secondaryLabel="I don't want notifications"
        onSecondary={() => goTo("confirm-none")}
      >
        <View style={styles.examples}>
          {NOTIFICATION_EXAMPLES.map((example) => (
            <View key={example.label} style={styles.exampleRow}>
              <View style={styles.exampleIcon}>
                <MaterialIcons name={example.icon} size={18} color={colors.tint} />
              </View>
              <View style={styles.exampleText}>
                <ThemedText style={styles.exampleLabel}>{example.label}</ThemedText>
                <ThemedText style={styles.exampleDetail}>{example.detail}</ThemedText>
              </View>
            </View>
          ))}
        </View>
        {renderEmailButton("Email", "all")}
      </IntroPageShell>
    );
  }

  return (
    <>
      {page}
      {push.helpDialog}
    </>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    examples: {
      gap: 8,
      paddingTop: 4,
    },
    exampleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    exampleIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
    },
    exampleText: {
      flex: 1,
      gap: 1,
    },
    exampleLabel: {
      fontSize: 14,
      // Explicit: `ThemedText`'s default line height is 24 and survives a
      // fontSize override, which would leave these two lines far apart.
      lineHeight: 18,
      fontWeight: "700",
      color: colors.text,
    },
    exampleDetail: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    emailButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 14,
      minHeight: 54,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    emailButtonText: {
      flex: 1,
      gap: 1,
    },
    emailButtonLabel: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      color: colors.text,
    },
    emailButtonNote: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    disabled: {
      opacity: 0.5,
    },
  });
