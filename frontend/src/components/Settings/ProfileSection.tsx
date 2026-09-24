/**
 * Profile: your avatar, username and email — the app's "My profile" card.
 * The avatar is the one friends see: the Letterboxd avatar only once it is
 * switched on (Letterboxd section), the coloured initial otherwise.
 *
 * Changing either asks for the current password, as the app does; an account
 * with no password yet (signed up with Apple or Google) has nothing to confirm
 * with, so it is sent to the Password section first.
 *
 * The email carries its verification state beside its label. "Not verified"
 * opens the dialog with the resend; the refresh beside it re-reads the account,
 * because the link is opened somewhere else — a mail app, a phone — and the
 * page cannot know when that has happened. A save that changes the address
 * says a new link was sent to it, since that is the part the user has to act on.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { MdCheckCircle, MdRefresh, MdWarningAmber } from "react-icons/md"
import { type ApiError, MeService, type UserUpdate } from "shared"
import useAuth from "shared/hooks/useAuth"
import { handleError } from "shared/utils"

import { FriendButton } from "@/components/Friends/friend-controls"
import { PersonAvatar } from "@/components/Showtimes/detail/PersonAvatar"
import useCustomToast from "@/hooks/useCustomToast"
import { emailPattern, usernameMaxLength, usernamePattern } from "@/utils"

import EmailVerificationDialog from "./EmailVerificationDialog"
import { SettingsField, SettingsSection } from "./settings-controls"
import { sectionMeta } from "./settings-sections"

/** Long enough that the spinner reads as a check rather than a flicker. */
const VERIFICATION_SPINNER_MIN_MS = 500

const ProfileSection = ({ onGoToPassword }: { onGoToPassword: () => void }) => {
  // Read flow: account and form state first, then the writes, then JSX.
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const meta = sectionMeta("profile")
  const hasPassword = user?.has_password ?? true

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isVerificationOpen, setIsVerificationOpen] = useState(false)
  const [isChecking, setIsChecking] = useState(false)

  // The fields follow the account whenever it changes, and start from it.
  const [syncedUser, setSyncedUser] = useState<typeof user>(undefined)
  if (user && user !== syncedUser) {
    setSyncedUser(user)
    setUsername(user.display_name ?? "")
    setEmail(user.email ?? "")
  }

  const mutation = useMutation({
    mutationFn: (data: UserUpdate) =>
      MeService.updateUserMe({ requestBody: data }),
    onSuccess: (updated, variables) => {
      setCurrentPassword("")
      // PATCH /me answers with exactly what GET /me would, so the answer goes
      // straight into the cache: a changed address has to read "Not verified"
      // the moment the save lands, not once a refetch comes back.
      queryClient.setQueryData(["currentUser"], updated)
      const before = (user?.email ?? "").trim().toLowerCase()
      const after = variables.email?.trim() ?? ""
      // A new address is now unconfirmed, which brings up the "Confirm your
      // email" tip (`Tips/VerifyEmailTip`) with its "Send the link again". It
      // used to be joined by a second, plainer dialog from here saying the same.
      showSuccessToast(
        after && after.toLowerCase() !== before
          ? `Profile updated. We sent a confirmation link to ${after}.`
          : "Profile updated.",
      )
    },
    // The server's own words: "that username is taken" is something to act on.
    onError: (err) => setError(handleError(err as ApiError)),
  })

  const normalizedUsername = username.trim()
  const isChanged =
    normalizedUsername !== (user?.display_name ?? "").trim() ||
    email.trim() !== (user?.email ?? "").trim()

  const handleSave = () => {
    setError(null)
    if (!normalizedUsername) {
      setError("Your account needs a username.")
      return
    }
    const isUsernameChanged =
      normalizedUsername.toLowerCase() !==
      (user?.display_name ?? "").trim().toLowerCase()
    if (isUsernameChanged && !usernamePattern.value.test(normalizedUsername)) {
      setError(usernamePattern.message)
      return
    }
    if (!email.trim() || !emailPattern.value.test(email.trim())) {
      setError("Enter a valid email address.")
      return
    }
    mutation.mutate({
      display_name: normalizedUsername,
      email: email.trim(),
      current_password: currentPassword,
    })
  }

  const handleCheckVerification = () => {
    if (isChecking) return
    setIsChecking(true)
    const startedAt = Date.now()
    MeService.getCurrentUser()
      .then((fresh) => queryClient.setQueryData(["currentUser"], fresh))
      .catch(() => {})
      .finally(() => {
        const remaining = Math.max(
          0,
          VERIFICATION_SPINNER_MIN_MS - (Date.now() - startedAt),
        )
        window.setTimeout(() => setIsChecking(false), remaining)
      })
  }

  const emailStatus = user?.email_verified ? (
    <span className="st-email-status st-email-status--ok">
      <MdCheckCircle aria-hidden />
      <span className="st-email-status__label">Verified</span>
    </span>
  ) : (
    <span className="st-email-status st-email-status--pending">
      <button type="button" onClick={() => setIsVerificationOpen(true)}>
        <MdWarningAmber aria-hidden />
        <span className="st-email-status__label">Not verified</span>
      </button>
      <button
        type="button"
        onClick={handleCheckVerification}
        disabled={isChecking}
        aria-label="Check whether the email has been verified"
        title="Opened the link? Check again"
      >
        <MdRefresh className={isChecking ? "st-spin" : undefined} aria-hidden />
      </button>
    </span>
  )

  const canSave =
    hasPassword && Boolean(currentPassword) && isChanged && !mutation.isPending

  return (
    <SettingsSection id="profile" title="Profile" icon={meta.icon}>
      <div className="st-card">
        <form
          className="st-card__body"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) handleSave()
          }}
        >
          {user ? (
            <div className="st-profile-head">
              <PersonAvatar user={user} size={56} />
              <div className="st-profile-head__text">
                <span className="st-profile-head__name">
                  {user.display_name}
                </span>
                <span className="st-profile-head__caption">
                  {user.avatar_url
                    ? "Your Letterboxd avatar, as friends see it."
                    : "Your coloured initial. You can use your Letterboxd avatar instead under Letterboxd."}
                </span>
              </div>
            </div>
          ) : null}
          <div className="st-fields">
            <SettingsField label="Username" htmlFor="settings-username">
              <input
                id="settings-username"
                className="st-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="username"
                maxLength={usernameMaxLength}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
              />
            </SettingsField>
            <SettingsField
              label="Email"
              htmlFor="settings-email"
              aside={emailStatus}
            >
              <input
                id="settings-email"
                className="st-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </SettingsField>
            {hasPassword ? (
              <SettingsField
                label="Current password"
                htmlFor="settings-profile-password"
                wide
              >
                <input
                  id="settings-profile-password"
                  className="st-input"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Required to change your username or email"
                  autoComplete="current-password"
                />
              </SettingsField>
            ) : null}
          </div>
          {!hasPassword ? (
            <p className="st-help">
              Set a password before you can change your username or email.{" "}
              <button
                type="button"
                className="st-text-button"
                onClick={onGoToPassword}
              >
                Add a password
              </button>
            </p>
          ) : null}
          {error ? <p className="st-error">{error}</p> : null}
          <div className="st-actions st-actions--end">
            <button type="submit" hidden aria-hidden tabIndex={-1} />
            <FriendButton primary busy={!canSave} onClick={handleSave}>
              {mutation.isPending ? "Updating…" : "Update profile"}
            </FriendButton>
          </div>
        </form>
      </div>

      <EmailVerificationDialog
        open={isVerificationOpen}
        onClose={() => setIsVerificationOpen(false)}
      />
    </SettingsSection>
  )
}

export default ProfileSection
