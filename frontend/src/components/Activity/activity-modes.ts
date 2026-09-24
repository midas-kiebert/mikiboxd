/**
 * The Activity page's three slices, in the app's order and with its words
 * (`mobile/app/(tabs)/activity.tsx`):
 *
 *   All     — you and your friends, together.
 *   You     — your own agenda: going, interested, and every invite.
 *   Friends — friends only, your own selections dropped.
 *
 * "You" sits in the middle in the app because the three are a swipe pager
 * there and the middle page is never two swipes away. There is no pager here,
 * but the order stays, so the two clients' controls read the same.
 */
import type { IconType } from "react-icons"
import { FiGrid, FiUser, FiUsers } from "react-icons/fi"

export type ActivityMode = "all" | "you" | "friends"

export type ActivityModeOption = {
  value: ActivityMode
  label: string
  icon: IconType
  /** One line under the control saying what the slice is. */
  description: string
}

export const ACTIVITY_MODES: readonly ActivityModeOption[] = [
  {
    value: "all",
    label: "All",
    icon: FiGrid,
    description:
      "Every screening you or a friend is going to or interested in.",
  },
  {
    value: "you",
    label: "You",
    icon: FiUser,
    description: "Your own plans, and everything you've been invited to.",
  },
  {
    value: "friends",
    label: "Friends",
    icon: FiUsers,
    description: "What your friends are going to or interested in.",
  },
]

export const DEFAULT_ACTIVITY_MODE: ActivityMode = "all"

/**
 * `?mode=` as the route reads it. The default is left out of the URL rather
 * than written into it, so a plain `/activity` link is the canonical one.
 */
export const parseActivityMode = (value: unknown): ActivityMode | undefined =>
  ACTIVITY_MODES.some((option) => option.value === value) &&
  value !== DEFAULT_ACTIVITY_MODE
    ? (value as ActivityMode)
    : undefined
