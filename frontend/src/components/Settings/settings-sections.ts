/**
 * The sections of the Settings page, in order: what the index lists and what
 * the page draws. Each id is the section's anchor, so `/settings#privacy`
 * lands on it — the showtime panel's "Change your default" link does.
 *
 * `guest` marks the sections that belong to this browser rather than to an
 * account, which a signed-out visitor gets as well, as in the app.
 */
import type { ComponentType } from "react"
import {
  MdBlock,
  MdConfirmationNumber,
  MdInfoOutline,
  MdLockOutline,
  MdManageAccounts,
  MdNotificationsNone,
  MdPalette,
  MdPersonOutline,
  MdVisibility,
  MdWarningAmber,
} from "react-icons/md"

import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"

export type SettingsSectionId =
  | "profile"
  | "password"
  | "letterboxd"
  | "notifications"
  | "privacy"
  | "blocked"
  | "appearance"
  | "cineville"
  | "about"
  | "account"
  | "danger-zone"

export type SettingsSectionMeta = {
  id: SettingsSectionId
  label: string
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  guest: boolean
  danger?: boolean
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: "profile", label: "Profile", icon: MdPersonOutline, guest: false },
  { id: "password", label: "Password", icon: MdLockOutline, guest: false },
  {
    id: "letterboxd",
    label: "Letterboxd",
    icon: PanelIcon.letterboxd,
    guest: false,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: MdNotificationsNone,
    guest: false,
  },
  { id: "privacy", label: "Privacy", icon: MdVisibility, guest: false },
  { id: "blocked", label: "Blocked accounts", icon: MdBlock, guest: false },
  { id: "appearance", label: "Appearance", icon: MdPalette, guest: false },
  {
    id: "cineville",
    label: "Cineville",
    icon: MdConfirmationNumber,
    guest: true,
  },
  { id: "about", label: "About", icon: MdInfoOutline, guest: true },
  { id: "account", label: "Account", icon: MdManageAccounts, guest: false },
  {
    id: "danger-zone",
    label: "Danger zone",
    icon: MdWarningAmber,
    guest: false,
    danger: true,
  },
]

export const sectionMeta = (id: SettingsSectionId): SettingsSectionMeta =>
  SETTINGS_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SECTIONS[0]
