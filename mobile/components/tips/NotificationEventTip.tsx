/**
 * The shell of the three "you missed something" tips (an invite, a sold-out
 * screening, a friend request): says what happened, then offers the one
 * notification that would have told the user, as push or as email.
 *
 * Push goes through `usePushPermissionFlow`: the OS prompt if it can still be
 * asked, otherwise the exact steps to switch notifications on in system
 * settings — where the user can also still pick email instead. The preference
 * is only written once push can actually arrive, so it never claims a delivery
 * that will not happen.
 *
 * After a choice the dialog stays up to confirm it (like the other tips), and
 * leaves no reminder in the bell when closed: there is nothing left to do.
 */
import { type ReactNode, useCallback, useState } from "react";
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQueryClient } from "@tanstack/react-query";
import { MeService, type UserUpdate } from "shared/client";
import {
  buildDeliveryUpdate,
  type NotificationPreferenceKey,
} from "shared/notifications/preferences";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePushPermissionFlow } from "@/hooks/usePushPermissionFlow";
import { closeTip, dismissTipForever, type FeatureTipId, useDismissTip } from "@/utils/feature-tips";

type NotificationEventTipProps = {
  tipId: FeatureTipId;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  message: string;
  preferenceKey: NotificationPreferenceKey;
  /** What the notification is called once on, e.g. "Invite notifications". */
  enabledName: string;
  children?: ReactNode;
};

export default function NotificationEventTip({
  tipId,
  icon,
  title,
  message,
  preferenceKey,
  enabledName,
  children,
}: NotificationEventTipProps) {
  // Read flow: data hooks first, then handlers, then the JSX.
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const dismissTip = useDismissTip(tipId);
  const [enabledVia, setEnabledVia] = useState<"push" | "email" | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(
    async (delivery: "push" | "email") => {
      setIsSaving(true);
      try {
        const updated = await MeService.updateUserMe({
          requestBody: buildDeliveryUpdate(preferenceKey, delivery) as UserUpdate,
        });
        queryClient.setQueryData(["currentUser"], updated);
        setEnabledVia(delivery);
      } catch (error) {
        console.error("Error turning a notification on from a tip:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [preferenceKey, queryClient]
  );

  const chooseEmail = useCallback(() => void save("email"), [save]);

  const push = usePushPermissionFlow({
    onGranted: () => void save("push"),
    helpAlternative: { label: "Email me instead", onPress: chooseEmail },
  });

  // Once a choice is made the tip is done: closing it is not a snooze.
  const handleDismiss = useCallback(
    (dismissForever: boolean) => {
      if (enabledVia === null) {
        dismissTip(dismissForever);
        return;
      }
      if (dismissForever) dismissTipForever(tipId);
      else closeTip(tipId);
    },
    [dismissTip, enabledVia, tipId]
  );

  // One dialog throughout, so confirming the choice changes its contents
  // rather than swapping in a second dialog with its own entrance.
  const isDone = enabledVia !== null;
  const confirmation =
    enabledVia === "push"
      ? `${enabledName} will arrive as push notifications. You can change this in Settings.`
      : currentUser?.email_verified
        ? `${enabledName} will arrive by email. You can change this in Settings.`
        : `${enabledName} will arrive by email as soon as you've confirmed your address. You can change this in Settings.`;

  return (
    <>
      <FeatureTipModal
        tipId={tipId}
        icon={isDone ? "notifications-active" : icon}
        title={isDone ? `${enabledName} on` : title}
        message={isDone ? confirmation : message}
        actionLabel={isDone ? "Done" : "Get push notifications"}
        onAction={isDone ? undefined : () => void push.request()}
        closeOnAction={isDone}
        isActionBusy={push.isRequesting || isSaving}
        secondaryActionLabel={isDone ? undefined : "Email me instead"}
        onSecondaryAction={isDone ? undefined : chooseEmail}
        onDismiss={handleDismiss}
      >
        {isDone ? null : children}
      </FeatureTipModal>
      {push.helpDialog}
    </>
  );
}
