/**
 * Feature tip: a friend invited the user while the app was closed, and invites
 * cannot reach them (off, or set to push on a device that cannot receive one).
 * Two wordings, one tip:
 *  - the screening is still ahead: "You got an invite!", with the invite
 *    itself, which opens the screening so they can still answer it;
 *  - it has started without them ever looking at their invites (app or
 *    website): "You missed an invite", with the invite they missed.
 *
 * Eligibility and which invite to show live in `FeatureTipsHost`.
 */
import type { AwayInvite } from "shared/client";

import { useShowtimeModal } from "@/components/showtimes/ShowtimeModalProvider";
import NotificationEventTip from "@/components/tips/NotificationEventTip";
import TipScreeningRow from "@/components/tips/TipScreeningRow";
import { snoozeTip } from "@/utils/feature-tips";

type InviteTipProps = {
  invite: AwayInvite;
  isMissed: boolean;
};

export default function InviteTip({ invite, isMissed }: InviteTipProps) {
  const { openShowtimeModalById } = useShowtimeModal();
  const sender = invite.sender_name ?? "A friend";

  // The showtime sheet sits under the tip's window, so the tip has to go
  // first. Snoozed, not closed: the notification question is still open, and
  // the bell keeps it for later.
  const handleOpenInvite = () => {
    snoozeTip("invite");
    openShowtimeModalById(invite.screening.showtime_id);
  };

  return (
    <NotificationEventTip
      tipId="invite"
      icon="mail"
      title={isMissed ? "You missed an invite!" : "You got an invite!"}
      message={
        isMissed
          ? `${sender} invited you, but the screening has already started. Turn on notifications for invites so you don't miss the next one.`
          : `${sender} invited you to a screening. Turn on notifications for invites so you hear about the next one straight away.`
      }
      preferenceKey="notify_on_showtime_ping"
      enabledName="Invite notifications"
    >
      <TipScreeningRow
        screening={invite.screening}
        caption={`Invite from ${sender}`}
        onPress={isMissed ? undefined : handleOpenInvite}
      />
    </NotificationEventTip>
  );
}
