export const SHOWTIME_PING_WEB_BASE_URL = "https://mikino.nl";

export function buildShowtimePingUrl(showtimeId: number, token: string) {
  return `${SHOWTIME_PING_WEB_BASE_URL}/ping/${encodeURIComponent(String(showtimeId))}/${encodeURIComponent(
    token
  )}`;
}
