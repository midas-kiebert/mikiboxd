/**
 * The one definition of the app's primary navigation, shared by the desktop
 * top bar and the mobile bottom bar.
 *
 * These are the app's tabs, in the app's order and with the app's names. The
 * two web navs used to carry their own lists — different order, different
 * entries — and both disagreed with the app, which has exactly four:
 * `mobile/app/(tabs)/_layout.tsx`.
 *
 * Two web pages deliberately have no entry here:
 *
 *   - Films (`/movies`) is not a destination in the app; it is the Showtimes
 *     tab's "one row per film" mode, which the home feed already has as
 *     `?group=`. A nav entry for it was a second door to the same room.
 *   - Your agenda (`/me/showtimes`) is the app's Activity "You" mode. The web
 *     Activity page is still the notification feed, so the route stays
 *     reachable by URL until Activity grows the app's mode pager.
 */
import type { IconType } from "react-icons"
import { FaUserFriends } from "react-icons/fa"
import { FiList, FiSettings, FiShield, FiZap } from "react-icons/fi"

/** Which count, if any, rides on a nav entry as a badge. */
export type NavBadge = "activity" | "friendRequests"

export interface NavItem {
  icon: IconType
  title: string
  path: string
  badge?: NavBadge
}

export const NAV_ITEMS: NavItem[] = [
  { icon: FiList, title: "Showtimes", path: "/" },
  { icon: FiZap, title: "Activity", path: "/pings", badge: "activity" },
  {
    icon: FaUserFriends,
    title: "Friends",
    path: "/friends",
    badge: "friendRequests",
  },
  { icon: FiSettings, title: "Settings", path: "/settings" },
]

/** Superusers get a fifth entry the app has no equivalent for. */
export const ADMIN_NAV_ITEM: NavItem = {
  icon: FiShield,
  title: "Admin",
  path: "/admin",
}

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

export const getNavItems = (isSuperuser: boolean): NavItem[] =>
  isSuperuser ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS
