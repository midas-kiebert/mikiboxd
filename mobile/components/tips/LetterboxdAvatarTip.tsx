/**
 * Feature tip: use the Letterboxd profile picture as your avatar on MiKiNO.
 *
 * Off by default (connecting Letterboxd for the watchlist is not consent to
 * show its picture), so this is where the option gets discovered. Only offered
 * once a sync has actually read a picture, and it previews that picture in the
 * circle friends will see, so the user knows exactly what they are opting in
 * to. Writes the same field as the switch in Settings → Letterboxd.
 *
 * Also opened by Settings → Letterboxd right after a username is set for the
 * first time (`onClose` given). That is a direct follow-up to what the user
 * just did rather than a nag, so it has no "Don't show again" toggle and does
 * not touch the tip's dismissal state.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and writes.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import useLetterboxdAvatarPreference from "shared/hooks/useLetterboxdAvatarPreference";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import PersonAvatar from "@/components/ui/PersonAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDismissTip } from "@/utils/feature-tips";

const PREVIEW_SIZE = 72;

export default function LetterboxdAvatarTip({ onClose }: { onClose?: () => void }) {
  const dismissTip = useDismissTip("letterboxd-avatar");
  const currentUser = useCurrentUser();
  const avatarPreference = useLetterboxdAvatarPreference();
  // Latched locally: once enabled the host's eligibility turns false, and the
  // dialog should say "done" rather than vanish mid-tap.
  const [isEnabled, setIsEnabled] = useState(false);

  const handleEnable = () => {
    avatarPreference.setEnabled(true);
    setIsEnabled(true);
  };

  return (
    <FeatureTipModal
      tipId="letterboxd-avatar"
      icon="account-circle"
      title={isEnabled ? "Picture on" : "Use your Letterboxd picture?"}
      message={
        isEnabled
          ? "Friends now see your Letterboxd picture. You can turn it off in Settings → Letterboxd."
          : avatarPreference.pictureUrl
            ? "Show your Letterboxd profile picture to friends on MiKiNO instead of a coloured initial. It's off until you say so."
            : "Show your Letterboxd profile picture to friends on MiKiNO instead of a coloured initial. We'll fetch it from Letterboxd as soon as you turn this on."
      }
      actionLabel={isEnabled ? "Done" : "Use my picture"}
      onAction={isEnabled ? undefined : handleEnable}
      closeOnAction={isEnabled}
      hideDismissForever={onClose !== undefined}
      onDismiss={onClose ? () => onClose() : dismissTip}
    >
      {currentUser ? (
        <View style={styles.preview}>
          <PersonAvatar
            userId={currentUser.id}
            name={currentUser.display_name ?? ""}
            avatarUrl={avatarPreference.pictureUrl}
            size={PREVIEW_SIZE}
            fontSize={28}
          />
        </View>
      ) : null}
    </FeatureTipModal>
  );
}

const styles = StyleSheet.create({
  preview: {
    alignItems: "center",
  },
});
