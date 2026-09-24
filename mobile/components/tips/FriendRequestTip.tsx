/**
 * Feature tip: someone sent the user a friend request while the app was
 * closed, and friend requests cannot reach them.
 *
 * Eligibility lives in `FeatureTipsHost`; this component only words it.
 */
import NotificationEventTip from "@/components/tips/NotificationEventTip";

export default function FriendRequestTip() {
  return (
    <NotificationEventTip
      tipId="friend-request"
      icon="person-add"
      title="You got a new friend request!"
      message="Turn on notifications for friend requests to hear about them as soon as they come in."
      preferenceKey="notify_on_friend_requests"
      enabledName="Friend request notifications"
    />
  );
}
