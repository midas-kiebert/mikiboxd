/**
 * The things an account is for, and what each is worth saying about.
 *
 * A guest meets these two ways — a whole tab they haven't unlocked, or a single
 * button they just tapped — and both should describe the *feature*, not the
 * wall. Same copy either way, so the sentence a guest reads on the Friends tab
 * is the one they read again if they tap "Invite" three screens later, and the
 * ask never reads as a different, arbitrary refusal each time.
 *
 * Rendered by `SignInRequiredDialog` (a tap) and `SignedOutPanel` (a screen).
 */
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";

export type AccountFeature =
  | "agenda"
  | "friends"
  | "going"
  | "invite"
  | "letterboxd"
  | "notifications"
  | "presets"
  | "profile"
  | "report";

type AccountFeatureCopy = {
  icon: keyof typeof MaterialIcons.glyphMap;
  /** Names the feature, never the restriction. */
  title: string;
  /** One sentence on what it does. Read directly under the title. */
  message: string;
};

export const ACCOUNT_FEATURE_COPY: Record<AccountFeature, AccountFeatureCopy> = {
  agenda: {
    icon: "event-available",
    title: "Your agenda",
    message:
      "Keep every screening you're going to in one place, and see who else is coming along.",
  },
  friends: {
    icon: "people",
    title: "Friends",
    message:
      "Follow the people you go to the cinema with, and find out what they're seeing.",
  },
  going: {
    icon: "check-circle",
    title: "Mark yourself going",
    message:
      "Save a screening to your agenda so your friends can see you're going and join you.",
  },
  invite: {
    icon: "mail",
    title: "Invite a friend",
    message: "Ask the people you watch films with to come to this screening.",
  },
  letterboxd: {
    icon: "bookmark-added",
    title: "Connect your Letterboxd",
    message:
      "Link your account to show only films on your watchlist, hide what you have already seen, and filter by your own lists.",
  },
  notifications: {
    icon: "notifications",
    title: "Notifications",
    message:
      "Get told when a friend is going to something you want to see, or invites you along.",
  },
  presets: {
    icon: "bookmark",
    title: "Saved filters",
    message:
      "Keep the filter combinations you use most, and bring one back in a tap.",
  },
  profile: {
    icon: "person",
    title: "Your profile",
    message:
      "Pick a username, link your Letterboxd, and choose how you'd like to be notified.",
  },
  report: {
    icon: "flag",
    title: "Report a problem",
    message:
      "Tell us when a screening's details are wrong so we can get it fixed.",
  },
};
