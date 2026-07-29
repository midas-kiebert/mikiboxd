/**
 * Shared handling for `mikino.nl/ping/{showtimeId}/{sender}` invite links.
 *
 * The link is acted on in exactly one place — the root layout, which reads the
 * URL itself both at launch and while the app is running. The `/ping` route
 * expo-router lands on is only a bouncer back to the tabs.
 */
import type { QueryClient } from "@tanstack/react-query";
import { ShowtimesService } from "shared";

export type ShowtimeInviteLink = { showtimeId: number; sender: string };

const INVITE_PATH_PATTERN = /^\/ping\/([^/]+)\/([^/]+)\/?$/;

/**
 * Pull the invite out of a full deep-link URL, whatever its scheme or host.
 * Hand-parsed rather than via `URL`, which React Native only has with a polyfill.
 */
export function parseInviteLinkUrl(url: string): ShowtimeInviteLink | null {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const pathStart = withoutScheme.indexOf("/");
  if (pathStart === -1) return null;
  const path = withoutScheme.slice(pathStart).split(/[?#]/)[0] ?? "";

  const match = INVITE_PATH_PATTERN.exec(path);
  if (!match) return null;

  return parseInviteLinkParts(match[1], match[2]);
}

function parseInviteLinkParts(
  rawShowtimeId: string | undefined,
  rawSender: string | undefined
): ShowtimeInviteLink | null {
  let decodedShowtimeId = rawShowtimeId ?? "";
  let decodedSender = rawSender ?? "";
  try {
    decodedShowtimeId = decodeURIComponent(decodedShowtimeId);
    decodedSender = decodeURIComponent(decodedSender);
  } catch {
    // Keep the raw values; the checks below still reject anything unusable.
  }

  const parsedShowtimeId = Number.parseInt(decodedShowtimeId.trim(), 10);
  if (!Number.isInteger(parsedShowtimeId) || parsedShowtimeId <= 0) return null;

  const trimmedSender = decodedSender.trim();
  if (trimmedSender.length === 0) return null;

  return { showtimeId: parsedShowtimeId, sender: trimmedSender };
}

/**
 * Record the invite server-side so it also lands in the Invites list. Best
 * effort: the sheet is already open by now, so a failure here must not surface.
 */
export async function registerInviteLink({
  showtimeId,
  sender,
  queryClient,
}: ShowtimeInviteLink & { queryClient: QueryClient }): Promise<void> {
  try {
    await ShowtimesService.receivePingFromLink({
      showtimeId,
      senderIdentifier: sender,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings"] }),
      queryClient.invalidateQueries({ queryKey: ["me", "showtimePings", "unseenCount"] }),
    ]);
  } catch (error) {
    console.error("Error registering invite from link:", error);
  }
}
