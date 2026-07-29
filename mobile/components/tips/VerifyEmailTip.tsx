/**
 * Feature tip: this account's email address has never been confirmed, so
 * nothing can be sent to it — notifications routed to email and the watchlist
 * digest both wait for the link to be opened. The dialog does not enumerate
 * those: the ask is "confirm your address", and listing what it unblocks reads
 * like a feature pitch for something the user may not want anyway.
 *
 * Unlike every other tip this one is unfinished business rather than a
 * suggestion, so it appears on every app start until it is done and carries no
 * "Don't show this again" (see `ALWAYS_SHOW_TIP_IDS`). It can still be closed —
 * it simply comes back next launch.
 *
 * The address is spelled out in the dialog on purpose: the commonest reason a
 * confirmation never arrives is a typo in it, and seeing it is what lets the
 * user notice. Fixing it is a trip to Settings, which the dialog does not
 * block.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and writes.
 */
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { MeService } from "shared";

import FeatureTipModal from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useDismissTip } from "@/utils/feature-tips";

export default function VerifyEmailTip() {
  // Read flow: data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("verify-email");
  const user = useCurrentUser();
  const [hasResent, setHasResent] = useState(false);

  const handleResend = useCallback(() => {
    // Painted before the request goes out: the button has to answer the tap
    // immediately, and the backend reports success either way (it will not say
    // whether an address needed confirming), so there is nothing to wait for.
    setHasResent(true);
    MeService.resendEmailVerification().catch(() => {});
  }, []);

  // Render/output using the state and handlers prepared above.
  return (
    <FeatureTipModal
      tipId="verify-email"
      icon="mark-email-unread"
      title="Confirm your email"
      message="We sent you a link when you signed up. Open it to confirm this address is yours. You'll need it to get back in if you forget your password, and nothing can be emailed to you until you do."
      actionLabel={hasResent ? "Link sent" : "Send the link again"}
      onAction={handleResend}
      isActionDisabled={hasResent}
      // No "Don't show this again": this is not a suggestion to opt out of.
      hideDismissForever
      onDismiss={dismissTip}
    >
      <View style={styles.details}>
        <ThemedText style={styles.address}>{user?.email ?? ""}</ThemedText>
        <ThemedText style={styles.hint}>
          {hasResent
            ? "Check your inbox, and your spam folder. Wrong address? You can change it in Settings."
            : "Already opened it? It may take a moment."}
        </ThemedText>
      </View>
    </FeatureTipModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    details: {
      gap: 6,
    },
    address: {
      fontSize: 15,
      // Explicit: the default type's lineHeight is 24 and survives a fontSize
      // override, which would leave these two lines drifting apart.
      lineHeight: 20,
      fontWeight: "700",
      color: colors.text,
    },
    hint: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });
