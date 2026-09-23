/**
 * Notifications — the app's Notifications card: one Off / Push / Email choice
 * per kind of notification, and the "notify on new films" email digest with
 * its sources.
 *
 * On/off and the channel are two backend fields but one decision, so they are
 * one segmented control, written together through the shared
 * `buildDeliveryUpdate` (a row can drive more than one field). Each pick
 * paints at once and goes back if the save fails.
 *
 * "Push" is an account setting: it goes to the app on your phone, which the
 * section says, since a browser cannot receive it. Routing anything to an
 * unconfirmed email is refused by the backend, so it is refused here first,
 * with the dialog that can resend the link.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type ComponentType, useState } from "react"
import {
  MdAlarm,
  MdEventBusy,
  MdGroups,
  MdLocalFireDepartment,
  MdMail,
  MdNotificationsActive,
  MdPersonAdd,
  MdWarningAmber,
} from "react-icons/md"
import { MeService, type UserUpdate } from "shared/client"
import useAuth from "shared/hooks/useAuth"
import {
  NOTIFICATION_LABELS,
  type NotificationDelivery,
  type NotificationPreferenceKey,
  TOGGLE_ORDER,
  buildDeliveryUpdate,
  getDelivery,
} from "shared/notifications/preferences"

import useCustomToast from "@/hooks/useCustomToast"

import DigestSources from "./DigestSources"
import EmailVerificationDialog from "./EmailVerificationDialog"
import {
  Segmented,
  type SegmentedOption,
  SettingsRow,
  SettingsSection,
  Switch,
} from "./settings-controls"
import { sectionMeta } from "./settings-sections"

/** The app's icons for each row (`useNotificationPreferences`). */
const ROW_ICONS: Record<
  NotificationPreferenceKey,
  ComponentType<{ className?: string }>
> = {
  notify_on_friend_showtime_match: MdGroups,
  notify_on_showtime_ping: MdMail,
  notify_on_interest_reminder: MdAlarm,
  notify_on_seat_alert: MdLocalFireDepartment,
  notify_on_sold_out: MdEventBusy,
  notify_on_friend_requests: MdPersonAdd,
  notify_on_showtime_reminder: MdNotificationsActive,
}

const DELIVERY_OPTIONS: readonly SegmentedOption<NotificationDelivery>[] = [
  { value: "off", label: "Off", neutral: true },
  { value: "push", label: "Push" },
  { value: "email", label: "Email" },
]

const NotificationsSection = ({
  onGoToLetterboxd,
}: { onGoToLetterboxd: () => void }) => {
  // Read flow: account and optimistic state first, then the writes, then JSX.
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const meta = sectionMeta("notifications")

  // Picks painted ahead of the server; cleared as each save settles.
  const [painted, setPainted] = useState<
    Partial<Record<NotificationPreferenceKey, NotificationDelivery>>
  >({})
  const [pendingKey, setPendingKey] =
    useState<NotificationPreferenceKey | null>(null)
  const [paintedDigest, setPaintedDigest] = useState<boolean | null>(null)
  const [isVerificationOpen, setIsVerificationOpen] = useState(false)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  const { mutate: save } = useMutation({
    mutationFn: (payload: UserUpdate) =>
      MeService.updateUserMe({ requestBody: payload }),
    onSuccess: (updated) => queryClient.setQueryData(["currentUser"], updated),
  })

  const setDelivery = (
    key: NotificationPreferenceKey,
    delivery: NotificationDelivery,
  ) => {
    if (delivery === "email" && !user?.email_verified) {
      setIsVerificationOpen(true)
      return
    }
    setPainted((previous) => ({ ...previous, [key]: delivery }))
    setPendingKey(key)
    save(buildDeliveryUpdate(key, delivery) as UserUpdate, {
      onError: () =>
        showErrorToast("Could not update that notification. Try again."),
      onSettled: () => {
        setPainted((previous) => {
          const { [key]: _, ...rest } = previous
          return rest
        })
        setPendingKey(null)
      },
    })
  }

  const digestEnabled =
    paintedDigest ?? Boolean(user?.notify_watchlist_digest_enabled)

  const setDigestEnabled = (enabled: boolean) => {
    // Nothing is sent to an address nobody has confirmed (the backend 403s).
    if (enabled && !user?.email_verified) {
      setIsVerificationOpen(true)
      return
    }
    setPaintedDigest(enabled)
    save(
      { notify_watchlist_digest_enabled: enabled },
      {
        onError: () =>
          showErrorToast("Could not update the new-films email. Try again."),
        onSettled: () => setPaintedDigest(null),
      },
    )
  }

  return (
    <SettingsSection
      id="notifications"
      title="Notifications"
      icon={meta.icon}
      description="Choose what you hear about and how. Push notifications arrive in the MiKiNO app on your phone; email arrives wherever you read your mail."
    >
      <div className="st-card">
        {TOGGLE_ORDER.map((key) => {
          const delivery = painted[key] ?? getDelivery(user, key)
          return (
            <SettingsRow
              key={key}
              title={NOTIFICATION_LABELS[key]}
              icon={ROW_ICONS[key]}
              isOff={delivery === "off"}
              isBusy={pendingKey === key}
            >
              <Segmented
                options={DELIVERY_OPTIONS}
                value={delivery}
                onChange={(next) => setDelivery(key, next)}
                label={NOTIFICATION_LABELS[key]}
                disabled={!user || pendingKey === key}
              />
            </SettingsRow>
          )
        })}
      </div>

      <div className="st-card">
        <SettingsRow
          title="Notify on new films"
          description="Email me when a film from my Letterboxd watchlist becomes available."
        >
          <Switch
            checked={digestEnabled}
            onChange={setDigestEnabled}
            label="Notify on new films"
            disabled={!user || paintedDigest !== null}
          />
        </SettingsRow>
        {digestEnabled ? (
          <div className="st-card__body">
            {!user?.letterboxd_username ? (
              <div className="st-notice">
                <MdWarningAmber aria-hidden />
                <p>
                  No Letterboxd username set, so there's no watchlist to follow
                  yet.{" "}
                  <button type="button" onClick={onGoToLetterboxd}>
                    Set a username
                  </button>{" "}
                  or{" "}
                  <button type="button" onClick={() => setIsAdvancedOpen(true)}>
                    use a list in advanced settings
                  </button>
                  .
                </p>
              </div>
            ) : null}
            <button
              type="button"
              className="st-text-button"
              aria-expanded={isAdvancedOpen}
              onClick={() => setIsAdvancedOpen((open) => !open)}
            >
              {isAdvancedOpen ? "Hide advanced settings" : "Advanced settings"}
            </button>
            {isAdvancedOpen ? (
              <DigestSources
                letterboxdUsername={user?.letterboxd_username ?? null}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <EmailVerificationDialog
        open={isVerificationOpen}
        onClose={() => setIsVerificationOpen(false)}
      />
    </SettingsSection>
  )
}

export default NotificationsSection
