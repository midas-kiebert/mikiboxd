/**
 * A feature tip the user closed, shown in the notification centre so the
 * suggestion is recoverable. Tapping it reopens the tip dialog.
 *
 * These are local and session-scoped (see `utils/feature-tips`); everything
 * else in the feed comes from the backend.
 */
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import NotificationRowLayout from "@/components/notifications/NotificationRowLayout";
import { useThemeColors } from "@/hooks/use-theme-color";
import type { FeatureTipId, SnoozedTip } from "@/utils/feature-tips";

type Presentation = {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  title: string;
  subtitle: string;
};

// Wording for the reminder, which is shorter and more direct than the dialog's.
const TIP_PRESENTATION: Record<FeatureTipId, Presentation> = {
  "verify-email": {
    icon: "mark-email-unread",
    title: "Confirm your email",
    subtitle: "Open the link we sent you",
  },
  "watchlist-digest": {
    icon: "mail",
    title: "Get watchlist films by email",
    subtitle: "Hear when one gets a screening at your cinemas",
  },
  "letterboxd-username": {
    icon: "bookmark-added",
    title: "Connect your Letterboxd watchlist",
    subtitle: "Filter screenings by your watchlist",
  },
  "letterboxd-avatar": {
    icon: "account-circle",
    title: "Use your Letterboxd picture",
    subtitle: "Let friends recognise you at a glance",
  },
  "add-friends": {
    icon: "person-add",
    title: "Add some friends",
    subtitle: "See what they're watching and plan screenings together",
  },
  "cinema-presets": {
    icon: "theaters",
    title: "Save your cinemas as a preset",
    subtitle: "Switch between sets of cinemas in one tap",
  },
  "filter-presets": {
    icon: "tune",
    title: "Save your filters as a quick filter",
    subtitle: "Reuse the filters you set most often",
  },
  invite: {
    icon: "mail",
    title: "Turn on invite notifications",
    subtitle: "So you don't miss the next invite from a friend",
  },
  "sold-out": {
    icon: "event-busy",
    title: "Turn on seat availability notifications",
    subtitle: "Hear before a screening you want sells out",
  },
  "friend-request": {
    icon: "person-add",
    title: "Turn on friend request notifications",
    subtitle: "Hear when someone adds you",
  },
  "interest-reminders": {
    icon: "alarm",
    title: "Turn on interest reminders",
    subtitle: "A nudge before screenings you're interested in",
  },
  "cineville-pass": {
    icon: "badge",
    title: "Add your Cineville pass",
    subtitle: "Keep your pass barcode one tap away",
  },
};

type FeatureTipNotificationRowProps = {
  tip: SnoozedTip;
  onPress: (id: FeatureTipId) => void;
  onDismiss: (id: FeatureTipId) => void;
};

export default function FeatureTipNotificationRow({
  tip,
  onPress,
  onDismiss,
}: FeatureTipNotificationRowProps) {
  const colors = useThemeColors();
  const presentation = TIP_PRESENTATION[tip.id];

  return (
    <NotificationRowLayout
      icon={presentation.icon}
      accent={colors.yellow}
      title={presentation.title}
      subtitle={presentation.subtitle}
      timestamp={tip.snoozedAt}
      isUnseen={!tip.seen}
      onPress={() => onPress(tip.id)}
      onDismiss={() => onDismiss(tip.id)}
      dismissLabel="Dismiss this reminder"
    />
  );
}
