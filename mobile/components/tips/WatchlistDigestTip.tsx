/**
 * Feature tip: the watchlist digest — an email when something on your
 * Letterboxd watchlist gets a showtime near you.
 *
 * The quietest tip in the app, deliberately. It is the only one whose
 * eligibility the backend decides (`show_watchlist_digest_tip` on /me), so the
 * feature can sit unadvertised in Settings for as long as it needs to, and both
 * the switch and the audience can change without a client release. On top of
 * that it carries the longest cooldown and the lowest show chance of any tip.
 *
 * Note the digest does not actually require a connected Letterboxd account — it
 * can follow a public list instead — but the tip is currently only offered to
 * users who have one. That is a deliberately narrow first audience, decided
 * server-side, not something this component should re-state as a requirement.
 *
 * Turning it on from here writes the same field the Settings switch does, so
 * the two cannot drift; everything else about the digest — how often, which
 * list, which cinemas — stays in Settings rather than being crammed in here.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and writes.
 */
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { MeService } from "shared";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import { currentUserQueryKey } from "@/hooks/useCurrentUser";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useDismissTip } from "@/utils/feature-tips";

export default function WatchlistDigestTip() {
  // Read flow: data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("watchlist-digest");
  const queryClient = useQueryClient();
  const [isEnabling, setIsEnabling] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  const handleEnable = useCallback(async () => {
    if (isEnabling || isEnabled) return;
    setIsEnabling(true);
    try {
      const updated = await MeService.updateUserMe({
        requestBody: { notify_watchlist_digest_enabled: true },
      });
      queryClient.setQueryData(currentUserQueryKey, updated);
      setIsEnabled(true);
    } catch (error) {
      console.error("Error enabling the watchlist digest:", error);
    } finally {
      setIsEnabling(false);
    }
  }, [isEnabled, isEnabling, queryClient]);

  // Render/output using the state and handlers prepared above.
  return (
    <FeatureTipModal
      tipId="watchlist-digest"
      icon={isEnabled ? "mark-email-read" : "mail"}
      title={isEnabled ? "You're subscribed" : "Get an email when a watchlist film lands"}
      message={
        isEnabled
          ? "You'll hear when a film from your watchlist gets a showtime. How often, and which cinemas count, are in Settings."
          : "We can email you when something on your Letterboxd watchlist gets a showtime at one of your cinemas, so you don't have to keep checking."
      }
      actionLabel={isEnabled ? "Done" : "Email me"}
      onAction={isEnabled ? undefined : () => void handleEnable()}
      isActionBusy={isEnabling}
      closeOnAction={isEnabled}
      onDismiss={dismissTip}
    >
      {!isEnabled ? (
        <View style={styles.details}>
          <ThemedText style={styles.hint}>
            You can set it to use a Letterboxd list instead of your
            watchlist in Settings.
          </ThemedText>
        </View>
      ) : null}
    </FeatureTipModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    details: {
      gap: 6,
    },
    hint: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });
