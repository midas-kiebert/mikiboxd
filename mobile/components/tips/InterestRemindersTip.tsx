/**
 * Feature tip: interest reminders are off (the default since they became
 * opt-in), so screenings the user marked as interesting pass without a nudge.
 * Low priority — the one notification most likely to feel like noise, which
 * is exactly why it is no longer on by default.
 *
 * Eligibility lives in `FeatureTipsHost`; this component only words it.
 */
import NotificationEventTip from "@/components/tips/NotificationEventTip";

export default function InterestRemindersTip() {
  return (
    <NotificationEventTip
      tipId="interest-reminders"
      icon="alarm"
      title="Want a reminder before your screenings?"
      message="Get a nudge in the day before a screening you marked as interested, while you can still decide whether to go."
      preferenceKey="notify_on_interest_reminder"
      enabledName="Interest reminders"
    />
  );
}
