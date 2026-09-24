/**
 * The two Letterboxd relationships a friend can have with a film, and the
 * wording, icon and palette each one gets.
 *
 * Centralised so the showtime panel, the movie page and the shared popup mark
 * "watchlisted" and "watched" identically — and so the website and the app do
 * too. Only the icon *name* is here, in the app's MaterialIcons vocabulary; the
 * web resolves it to the matching `react-icons/md` component and the app hands
 * it straight to `MaterialIcons`.
 */
export type FriendWatchKind = "watchlisted" | "watched";

export type FriendWatchKindCopy = {
  kind: FriendWatchKind;
  /** A MaterialIcons name, shared so the two clients cannot pick differently. */
  icon: "schedule" | "visibility";
  /** Which palette trio draws it: `primary` behind, `secondary` for the ink. */
  palette: "orange" | "green";
  /** Popup heading — deliberately just the relationship, nothing else. */
  title: string;
};

export const getFriendWatchKindCopy = (
  kind: FriendWatchKind,
): FriendWatchKindCopy =>
  kind === "watchlisted"
    ? { kind, icon: "schedule", palette: "orange", title: "Watchlisted" }
    : { kind, icon: "visibility", palette: "green", title: "Watched" };
