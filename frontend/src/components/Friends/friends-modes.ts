/**
 * The Friends page's two modes, as the app has them (`mobile/app/(tabs)/friends.tsx`):
 *
 *   Friends     — everyone you already have: requests waiting on you, the
 *                 ones you sent, and your friends, in one list.
 *   Find people — a search of everyone else.
 */
import type { IconType } from "react-icons"
import { MdPeople, MdPersonSearch } from "react-icons/md"

export type FriendsMode = "friends" | "discover"

export type FriendsModeOption = {
  value: FriendsMode
  label: string
  icon: IconType
  /** One line under the title saying what the mode is for. */
  description: string
  placeholder: string
}

export const FRIENDS_MODES: readonly FriendsModeOption[] = [
  {
    value: "friends",
    label: "Friends",
    icon: MdPeople,
    description: "Your friends, and any requests waiting on either of you.",
    placeholder: "Search your friends",
  },
  {
    value: "discover",
    label: "Find people",
    icon: MdPersonSearch,
    description: "Search everyone on MiKiNO by username.",
    placeholder: "Search everyone",
  },
]

export const DEFAULT_FRIENDS_MODE: FriendsMode = "friends"

/** `?mode=` as the route reads it; the default is left out of the URL. */
export const parseFriendsMode = (value: unknown): FriendsMode | undefined =>
  FRIENDS_MODES.some((option) => option.value === value) &&
  value !== DEFAULT_FRIENDS_MODE
    ? (value as FriendsMode)
    : undefined
