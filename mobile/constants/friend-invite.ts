export const FRIEND_INVITE_WEB_BASE_URL = "https://mikino.nl";
export const PENDING_FRIEND_INVITE_RECEIVER_ID_KEY =
  "pending_friend_invite_receiver_id";

export function buildFriendInviteUrl(receiverId: string) {
  return `${FRIEND_INVITE_WEB_BASE_URL}/add-friend/${encodeURIComponent(receiverId)}`;
}
