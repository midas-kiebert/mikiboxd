/**
 * TanStack Router route module for reset-password: where the "reset your
 * password" email link lands.
 */
import { useMutation } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { type SubmitHandler, useForm } from "react-hook-form"
import { type ApiError, LoginService, type NewPassword } from "shared"
import useAuth from "shared/hooks/useAuth"
import { handleError } from "shared/utils"

import { primeSession } from "@/auth/session"
import { useIsSignedIn } from "@/auth/useSession"
import { AuthField, AuthShell } from "@/components/Auth/AuthShell"
import useCustomToast from "@/hooks/useCustomToast"
import { confirmPasswordRules, passwordRules } from "@/utils"

interface NewPasswordForm extends NewPassword {
  confirm_password: string
}

// No "already signed in, go home" guard, unlike /login and /signup. The token
// in the link says which account is being reset, and it need not be the one
// signed in here — someone resetting their other account, or a shared browser.
// The guard sent every such click straight to the feed, so the link looked
// broken.
export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  // Outside `_layout`, so the session is read here: the page says whose
  // browser session will end once the password is set.
  beforeLoad: async () => {
    await primeSession()
  },
})

function ResetPassword() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const navigate = useNavigate()
  const { showSuccessToast } = useCustomToast()
  const isSignedIn = useIsSignedIn()
  const { user, logout } = useAuth()
  const token = new URLSearchParams(window.location.search).get("token")

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<NewPasswordForm>({
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: { new_password: "", confirm_password: "" },
  })

  const mutation = useMutation({
    mutationFn: (data: NewPassword) =>
      LoginService.resetPassword({ requestBody: data }),
    onSuccess: async () => {
      showSuccessToast("Password updated. Log in with your new password.")
      // Signed in as someone — perhaps another account — so the new password
      // could not be used without first leaving that session.
      if (isSignedIn) await logout()
      void navigate({ to: "/login" })
    },
  })

  const onSubmit: SubmitHandler<NewPasswordForm> = (data) => {
    if (!token) return
    mutation.mutate({ new_password: data.new_password, token })
  }

  if (!token) {
    return (
      <AuthShell
        title="This link is incomplete"
        lede="The reset link is missing part of its address. Open it again from the email, or ask for a new one."
      >
        <div className="au-card">
          <Link to="/recover-password" className="au-button au-button--primary">
            Send a new link
          </Link>
        </div>
      </AuthShell>
    )
  }

  // Render/output using the state and derived values prepared above.
  return (
    <AuthShell
      title="Choose a new password"
      lede="Type it twice. You'll log in with it straight after."
    >
      <form className="au-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        {isSignedIn && user ? (
          <p className="au-note">
            You're signed in as <strong>{user.email}</strong> in this browser.
            You'll be signed out once the new password is set, so you can log in
            with it.
          </p>
        ) : null}
        <AuthField
          id="new_password"
          label="New password"
          type="password"
          autoComplete="new-password"
          error={errors.new_password?.message}
          {...register("new_password", passwordRules())}
        />
        <AuthField
          id="confirm_password"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirm_password?.message}
          {...register("confirm_password", confirmPasswordRules(getValues))}
        />
        {mutation.error ? (
          <p className="au-error au-error--form">
            {handleError(mutation.error as ApiError)}
          </p>
        ) : null}
        <button
          type="submit"
          className="au-button au-button--primary"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Set new password"}
        </button>
      </form>
    </AuthShell>
  )
}
