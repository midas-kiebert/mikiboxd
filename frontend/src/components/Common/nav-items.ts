/**
 * The one definition of the app's primary navigation, shared by the desktop
 * top bar and the mobile bottom bar.
 *
 * These are the app's tabs, in the app's order and with the app's names. The
 * two web navs used to carry their own lists — different order, different
 * entries — and both disagreed with the app, which has exactly four:
 * `mobile/app/(tabs)/_layout.tsx`. The website shows three of them: the
 * app's fourth, Settings, is in the account menu here (see below).
 *
 * Notifications are not here: the app keeps them behind a bell rather than in
 * its tab bar, and so does the website — `Notifications/NotificationBell.tsx`,
 * beside the account chip.
 *
 * Neither are Settings and Admin: they live in the account chip's menu
 * (`NavAccount.tsx`), which is where a site keeps the things that are about
 * your account rather than places to go. Admin is there for superusers only.
 *
 * Two web pages deliberately have no entry here:
 *
 *   - Films (`/movies`) is not a destination in the app; it is the Showtimes
 *     tab's "one row per film" mode, which the home feed already has as
 *     `?group=`. A nav entry for it was a second door to the same room.
 *   - Your agenda (`/me/showtimes`) is no longer a page: it is the home
 *     feed's "Only my own plans" filter, and the old address redirects there.
 */
import type { IconType } from "react-icons"
import { FaUserFriends } from "react-icons/fa"
import { FiList, FiZap } from "react-icons/fi"

/**
 * Which count, if any, rides on a nav entry as a badge. `notifications` is the
 * bell's, which is not a tab but reads its count from the same place.
 */
export type NavBadge = "notifications" | "friendRequests"

export interface NavItem {
  icon: IconType
  title: string
  path: string
  badge?: NavBadge
}

export const NAV_ITEMS: NavItem[] = [
  { icon: FiList, title: "Screenings", path: "/" },
  { icon: FiZap, title: "Activity", path: "/activity" },
  {
    icon: FaUserFriends,
    title: "Friends",
    path: "/friends",
    badge: "friendRequests",
  },
]

/**
 * How big a nav icon is drawn, in both navs.
 *
 * Chakra's default is 1em, which made the nav icons read as punctuation
 * beside their label rather than as the app's tab icons.
 */
export const NAV_ICON_SIZE = "22px"

/** Badges are capped the same way the app caps them, so "99+" matches. */
export const MAX_BADGE_COUNT = 99

export const formatBadgeCount = (count: number): string =>
  count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count)
