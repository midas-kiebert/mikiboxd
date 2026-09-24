/**
 * The account itself: logging out, and — behind a disclosure, so reaching it
 * takes a deliberate click — deleting it. Both ask first, in the app's words.
 *
 * The backend refuses to delete a superuser's own account, so for one the
 * button is there but greyed out, with the reason beside it.
 */
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { MdExpandMore, MdLogout } from "react-icons/md"
import { type ApiError, MeService } from "shared"
import useAuth from "shared/hooks/useAuth"
import { handleError } from "shared/utils"

import { FriendButton } from "@/components/Friends/friend-controls"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import useCustomToast from "@/hooks/useCustomToast"

import { scrollPageTo } from "./page-scroll"
import {
  ConfirmDialog,
  SettingsRow,
  SettingsSection,
} from "./settings-controls"
import { sectionMeta } from "./settings-sections"

const useSignOut = () => {
  const navigate = useNavigate()
  return useAuth(
    () => navigate({ to: "/", search: defaultFeedParams }),
    // No onLogout: signing out leaves you on this page as a guest.
  )
}

export const AccountSection = () => {
  const { logout } = useSignOut()
  const meta = sectionMeta("account")
  const [isConfirming, setIsConfirming] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = async () => {
    // Painted before the request, so the button answers the click.
    setIsLoggingOut(true)
    try {
      await logout()
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <SettingsSection id="account" title="Account" icon={meta.icon}>
      <div className="st-card">
        <SettingsRow
          title="Log out"
          description="Signs you out of MiKiNO in this browser."
        >
          <FriendButton
            icon={<MdLogout size={15} />}
            busy={isLoggingOut}
            onClick={() => setIsConfirming(true)}
          >
            {isLoggingOut ? "Logging out…" : "Log out"}
          </FriendButton>
        </SettingsRow>
      </div>
      <ConfirmDialog
        open={isConfirming}
        title="Log out?"
        message="You will need to sign in again in this browser."
        confirmLabel="Log out"
        onConfirm={() => void handleLogout()}
        onClose={() => setIsConfirming(false)}
      />
    </SettingsSection>
  )
}

export const DangerZoneSection = () => {
  const { user, logout } = useSignOut()
  const isSuperuser = Boolean(user?.is_superuser)
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const meta = sectionMeta("danger-zone")
  const Icon = meta.icon
  const [isOpen, setIsOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  const deletion = useMutation({
    mutationFn: () => MeService.deleteUserMe(),
    onSuccess: async () => {
      showSuccessToast("Your account has been deleted.")
      await logout()
    },
    onError: (err) => showErrorToast(handleError(err as ApiError)),
  })

  return (
    <section
      id="danger-zone"
      className="st-section"
      aria-labelledby="danger-zone-title"
    >
      <button
        type="button"
        className="st-section__toggle"
        aria-expanded={isOpen}
        aria-controls="danger-zone-body"
        onClick={() => {
          const next = !isOpen
          setIsOpen(next)
          // The card opens below the fold at the end of the page; bring it up.
          if (next) {
            window.requestAnimationFrame(() =>
              scrollPageTo(document.getElementById("danger-zone-body"), {
                align: "end",
              }),
            )
          }
        }}
      >
        <Icon className="st-section__icon" aria-hidden />
        <h2 id="danger-zone-title" className="st-section__title">
          Danger zone
        </h2>
        <MdExpandMore className="st-section__caret" aria-hidden />
      </button>
      {isOpen ? (
        <div id="danger-zone-body" className="st-card st-card--danger">
          <div className="st-card__body">
            <p className="st-help">
              Permanently delete your account and all associated data. Your
              friends, screening selections and invites go with it. This cannot
              be undone.
            </p>
            {isSuperuser ? (
              <p className="st-help">
                Admin accounts can't be deleted from here.
              </p>
            ) : null}
            <div className="st-actions st-actions--end">
              <FriendButton
                destructive
                busy={isSuperuser || deletion.isPending}
                onClick={() => setIsConfirming(true)}
              >
                {deletion.isPending ? "Deleting…" : "Delete account"}
              </FriendButton>
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={isConfirming}
        tone="destructive"
        title="Delete account?"
        message="This permanently deletes your account and everything in it. It cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => deletion.mutate()}
        onClose={() => setIsConfirming(false)}
      />
    </section>
  )
}
