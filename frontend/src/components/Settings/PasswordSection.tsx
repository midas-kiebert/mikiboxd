/**
 * Password: change it, or add one — the app's "Password" / "Add password" card.
 *
 * An account that signed up with Apple or Google has no password yet, so it
 * gets the same form without the "current password" field, and adding one
 * lets it sign in with its email too.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type ApiError, MeService } from "shared"
import useAuth from "shared/hooks/useAuth"
import { handleError } from "shared/utils"

import { FriendButton } from "@/components/Friends/friend-controls"
import useCustomToast from "@/hooks/useCustomToast"

import { SettingsField, SettingsSection } from "./settings-controls"
import { sectionMeta } from "./settings-sections"

const PASSWORD_MIN_LENGTH = 8

const EMPTY_FORM = { current: "", next: "", confirm: "" }

const PasswordSection = () => {
  // Read flow: form state first, then the write, then JSX.
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const meta = sectionMeta("password")
  const hasPassword = user?.has_password ?? true

  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      MeService.updatePasswordMe({
        requestBody: {
          current_password: hasPassword ? form.current : null,
          new_password: form.next,
        },
      }),
    onSuccess: () => {
      setForm(EMPTY_FORM)
      showSuccessToast(hasPassword ? "Password updated." : "Password added.")
      // `has_password` flips for an account that just added its first one.
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    },
    onError: (err) => setError(handleError(err as ApiError)),
  })

  const isIncomplete =
    (hasPassword && !form.current) || !form.next || !form.confirm

  const handleSave = () => {
    setError(null)
    if (form.next.length < PASSWORD_MIN_LENGTH) {
      setError(
        `Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`,
      )
      return
    }
    if (form.next !== form.confirm) {
      setError("The two new passwords don't match.")
      return
    }
    mutation.mutate()
  }

  const field = (key: keyof typeof EMPTY_FORM) => ({
    className: "st-input",
    type: "password",
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm((previous) => ({ ...previous, [key]: event.target.value })),
  })

  return (
    <SettingsSection
      id="password"
      title={hasPassword ? "Password" : "Add a password"}
      icon={meta.icon}
      description={
        hasPassword
          ? undefined
          : "Your account signed in with Apple or Google and has no password yet. Add one to also be able to log in with your email."
      }
    >
      <div className="st-card">
        <form
          className="st-card__body"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isIncomplete && !mutation.isPending) handleSave()
          }}
        >
          <div className="st-fields">
            {hasPassword ? (
              <SettingsField
                label="Current password"
                htmlFor="settings-password-current"
                wide
              >
                <input
                  id="settings-password-current"
                  autoComplete="current-password"
                  {...field("current")}
                />
              </SettingsField>
            ) : null}
            <SettingsField label="New password" htmlFor="settings-password-new">
              <input
                id="settings-password-new"
                autoComplete="new-password"
                {...field("next")}
              />
            </SettingsField>
            <SettingsField
              label="Confirm new password"
              htmlFor="settings-password-confirm"
            >
              <input
                id="settings-password-confirm"
                autoComplete="new-password"
                {...field("confirm")}
              />
            </SettingsField>
          </div>
          {error ? <p className="st-error">{error}</p> : null}
          <div className="st-actions st-actions--end">
            <button type="submit" hidden aria-hidden tabIndex={-1} />
            <FriendButton
              primary
              busy={isIncomplete || mutation.isPending}
              onClick={handleSave}
            >
              {mutation.isPending
                ? "Saving…"
                : hasPassword
                  ? "Update password"
                  : "Add password"}
            </FriendButton>
          </div>
        </form>
      </div>
    </SettingsSection>
  )
}

export default PasswordSection
