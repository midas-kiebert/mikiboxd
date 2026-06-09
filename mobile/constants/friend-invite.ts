export const FRIEND_INVITE_WEB_BASE_URL = "https://mikino.nl";

export function buildFriendInviteUrl(receiverId: string) {
  return `${FRIEND_INVITE_WEB_BASE_URL}/add-friend/${encodeURIComponent(receiverId)}`;
}
