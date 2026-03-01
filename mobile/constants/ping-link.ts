export const SHOWTIME_PING_WEB_BASE_URL = "https://mikino.nl";
export const PENDING_SHOWTIME_PING_LINK_KEY = "pending_showtime_ping_link_v1";

export function buildShowtimePingUrl(showtimeId: number, senderIdentifier: string) {
  return `${SHOWTIME_PING_WEB_BASE_URL}/ping/${encodeURIComponent(String(showtimeId))}/${encodeURIComponent(
    senderIdentifier
  )}`;
}
