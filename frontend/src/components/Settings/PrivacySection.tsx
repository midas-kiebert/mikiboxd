/**
 * Privacy — the two screens the app's Settings → Privacy opens, drawn inline:
 * the default status visibility (`app/default-visibility.tsx`) and the blocked
 * accounts (`app/blocked-users.tsx`).
 *
 * **Default status visibility** is the mode a new showtime starts with until
 * you pick another for it. Changing it asks whether showtimes you already
 * picked should follow — nothing is saved, or painted as chosen, until that is
 * answered. An account with no picked showtimes has nothing to ask about;
 * that is tested against an explicit `false`, since an absent flag (an older
 * payload) is exactly when skipping the question would quietly move them all.
 * Wording, icons and palette come from `shared/showtimes/visibility-mode`, so
 * this privacy promise reads the same on the app, the panel and here.
 *
 * **Blocked accounts** is the only place a blocked account still appears —
 * search, friends and invites all leave it out — so it is also the only way
 * back to unblocking one.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  MdGroups,
  MdHub,
  MdMail,
  MdRadioButtonChecked,
  MdRadioButtonUnchecked,
} from "react-icons/md"
import { MeService, UsersService, type VisibilityMode } from "shared/client"
import useAuth from "shared/hooks/useAuth"
import { useFetchBlockedUsers } from "shared/hooks/useFetchBlockedUsers"
import { SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX } from "shared/hooks/useShowtimeVisibility"
import {
  VISIBILITY_MODE_ORDER,
  getVisibilityModeCopy,
  getVisibilityModePresentation,
} from "shared/showtimes/visibility-mode"

import { FriendButton } from "@/components/Friends/friend-controls"
import { PersonAvatar } from "@/components/Showtimes/detail/PersonAvatar"
import useCustomToast from "@/hooks/useCustomToast"

import { ConfirmDialog, SettingsSection } from "./settings-controls"
import { sectionMeta } from "./settings-sections"

/** The glyphs `shared/showtimes/visibility-mode` names, resolved for the web. */
const MODE_ICON = { hub: MdHub, groups: MdGroups, mail: MdMail } as const

const DEFAULT_MODE: VisibilityMode = "FRIENDS_OF_FRIENDS"

export const PrivacySection = () => {
  // Read flow: account and optimistic state first, then the write, then JSX.
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const meta = sectionMeta("privacy")

  const [paintedMode, setPaintedMode] = useState<VisibilityMode | null>(null)
  // Tapped but not yet answered "…and your existing showtimes?".
  const [pendingMode, setPendingMode] = useState<VisibilityMode | null>(null)
  const selected = paintedMode ?? user?.default_visibility_mode ?? DEFAULT_MODE

  const mutation = useMutation({
    mutationFn: (variables: {
      mode: VisibilityMode
      applyToExisting: boolean
    }) =>
      MeService.updateUserMe({
        requestBody: {
          default_visibility_mode: variables.mode,
          apply_default_visibility_to_existing: variables.applyToExisting,
        },
      }),
    // Written into the cache rather than invalidated, so clearing the painted
    // mode never shows the old one for the length of a refetch.
    onSuccess: (updated) => {
      queryClient.setQueryData(["currentUser"], updated)
      // Every showtime without its own setting was reading this default, so a
      // cached visibility for one now states the old default as fact. Purged
      // rather than invalidated: a stale entry would still paint first.
      queryClient.removeQueries({
        queryKey: SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX,
      })
    },
    onError: () => showErrorToast("Could not change your default. Try again."),
    onSettled: () => setPaintedMode(null),
  })

  const save = (mode: VisibilityMode, applyToExisting: boolean) => {
    setPaintedMode(mode)
    mutation.mutate({ mode, applyToExisting })
  }

  const handleSelect = (mode: VisibilityMode) => {
    if (mode === selected) return
    if (user?.has_selected_showtimes === false) {
      save(mode, true)
      return
    }
    setPendingMode(mode)
  }

  return (
    <SettingsSection
      id="privacy"
      title="Default status visibility"
      icon={meta.icon}
      description="Who can see your status on a new showtime, until you change it for that showtime. Friends you invite, and friends who invite you, always can."
    >
      <div
        className="st-options"
        role="radiogroup"
        aria-label="Default status visibility"
      >
        {VISIBILITY_MODE_ORDER.map((mode) => {
          const copy = getVisibilityModeCopy(mode)
          const { icon, palette } = getVisibilityModePresentation(mode)
          const Icon = MODE_ICON[icon]
          const isOn = mode === selected
          const accent = `var(--chakra-colors-app-${palette}\\.secondary)`
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={isOn}
              className="st-option"
              style={isOn ? { borderColor: accent } : undefined}
              disabled={mutation.isPending}
              onClick={() => handleSelect(mode)}
            >
              <span
                className="st-option__badge"
                style={{
                  background: `var(--chakra-colors-app-${palette}\\.primary)`,
                  color: accent,
                }}
              >
                <Icon aria-hidden />
              </span>
              <span className="st-row__text">
                <span className="st-row__title">{copy.label}</span>
                <span className="st-row__description">{copy.description}</span>
              </span>
              {isOn ? (
                <MdRadioButtonChecked
                  className="st-option__radio"
                  style={{ color: accent }}
                  aria-hidden
                />
              ) : (
                <MdRadioButtonUnchecked
                  className="st-option__radio"
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title="Apply to your showtimes too?"
        message="Showtimes you're going to or interested in follow this default. Keep them as they are, or apply the new setting to them too? Showtimes you set individually keep their own setting either way."
        confirmLabel="New showtimes only"
        secondaryLabel="Apply to all"
        onConfirm={() => {
          if (pendingMode) save(pendingMode, false)
        }}
        onSecondary={() => {
          if (pendingMode) save(pendingMode, true)
        }}
        onClose={() => setPendingMode(null)}
      />
    </SettingsSection>
  )
}

export const BlockedSection = () => {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const meta = sectionMeta("blocked")
  const { data: blocked, isLoading } = useFetchBlockedUsers()

  const unblock = useMutation({
    mutationFn: (userId: string) => UsersService.unblockUser({ userId }),
    onSuccess: (_, userId) => {
      const name = blocked
        ?.find((entry) => entry.id === userId)
        ?.display_name?.trim()
      showSuccessToast(name ? `${name} is unblocked.` : "Unblocked.")
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
    onError: () => showErrorToast("Could not unblock. Try again."),
  })

  return (
    <SettingsSection
      id="blocked"
      title="Blocked accounts"
      icon={meta.icon}
      description="Blocking someone hides you from each other and stops them contacting you."
    >
      <div className="st-card">
        {isLoading ? null : blocked?.length ? (
          blocked.map((entry) => {
            const name = entry.display_name?.trim() || "Unknown user"
            return (
              <div key={entry.id} className="st-person">
                <PersonAvatar user={entry} size={36} />
                <span className="st-person__name">{name}</span>
                <FriendButton
                  busy={unblock.isPending && unblock.variables === entry.id}
                  onClick={() => unblock.mutate(entry.id)}
                  label={`Unblock ${name}`}
                >
                  Unblock
                </FriendButton>
              </div>
            )
          })
        ) : (
          <div className="st-card__body">
            <p className="st-help">You haven't blocked anyone.</p>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
