/**
 * Why someone is reporting another user.
 *
 * Shared for the same reason the visibility copy is: these labels are what a
 * reviewer sees attached to a report, and two clients offering differently
 * worded reasons for the same enum value makes the moderation queue harder to
 * read than it needs to be.
 */
import type { UserReportReason } from "../client";

export const REPORT_REASON_OPTIONS: {
  value: UserReportReason;
  label: string;
}[] = [
  { value: "objectionable_username", label: "Objectionable username" },
  { value: "impersonation", label: "Impersonation" },
  {
    value: "repeated_unwanted_contact",
    label: "Repeated unwanted requests or invites",
  },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];
