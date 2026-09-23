/**
 * TanStack Router route module for signup. It connects URL state to the matching page component.
 */
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useTheme } from "next-themes"
import { type SubmitHandler, useForm } from "react-hook-form"
import { saveSelectionAsPreferred } from "shared/filters/cinema-presets"

import { AuthField, AuthShell } from "@/components/Auth/AuthShell"
import SocialSignIn from "@/components/Auth/SocialSignIn"
import { markIntroPending } from "@/features/intro/intro"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import { claimGuestPreferredCinemas } from "@/features/showtimes/guest-preferred-cinemas"
import {
  confirmPasswordRules,
  emailPattern,
  passwordRules,
  usernameMaxLength,
  usernamePattern,
} from "@/utils"
import type { UserRegister } from "shared"
import useAuth, { isLoggedIn } from "shared/hooks/useAuth"

export const Route = createFileRoute("/signup")({
  component: SignUp,
  beforeLoad: async () => {
    if (await isLoggedIn()) {
      throw redirect({
        to: "/",
        search: defaultFeedParams,
      })
    }
  },
})

interface UserRegisterForm extends UserRegister {
  confirm_password: string
}

function SignUp() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const navigate = useNavigate()
  // Data hooks keep this module synced with backend data and shared cache state.
  const {
    signUpMutation,
    loginMutation,
    socialLoginMutation,
    error,
    resetError,
  } = useAuth()
  const { setTheme } = useTheme()
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<UserRegisterForm>({
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      email: "",
      display_name: "",
      password: "",
      confirm_password: "",
    },
  })

  /**
   * Create the account, sign straight in with it, and carry over what the
   * visitor set up as a guest. Preferred cinemas are the one thing kept in a
   * guest-only place; language and feed style are this browser's already, so
   * they need no hand-over. Then the intro, which skips the cinema question
   * when the answer came along.
   */
  const onSubmit: SubmitHandler<UserRegisterForm> = async (data) => {
    if (isSubmitting) return
    resetError()
    try {
      await signUpMutation.mutateAsync(data)
      // A guest follows the system theme (`ui/provider.tsx`), but a signed-in
      // browser uses the stored choice — which may be an earlier member's. A
      // new account starts where the guest was, and before the sign-in below
      // lifts the guest override, so there is no flash of the old theme.
      setTheme("system")
      await loginMutation.mutateAsync({
        username: data.email,
        password: data.password,
      })
    } catch {
      // `useAuth` has put the message in `error`.
      return
    }

    const guestCinemaIds = claimGuestPreferredCinemas()
    if (guestCinemaIds.length > 0) {
      await saveSelectionAsPreferred({ cinemaIds: guestCinemaIds }).catch(
        () => undefined,
      )
    }
    markIntroPending({ skipCinemas: guestCinemaIds.length > 0 })
    void navigate({ to: "/", search: defaultFeedParams })
  }

  // Render/output using the state and derived values prepared above.
  return (
    <AuthShell
      title="Create your account"
      lede="Keep an agenda, see where your friends are going, and plan a night out together."
      switchTo={{
        text: "Already have an account?",
        label: "Log in",
        to: "/login",
      }}
    >
      <form className="au-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        <SocialSignIn
          mode="sign-up"
          socialLoginMutation={socialLoginMutation}
          resetError={resetError}
        />
        <AuthField
          id="display_name"
          label="Username"
          autoComplete="username"
          maxLength={usernameMaxLength}
          error={errors.display_name?.message}
          {...register("display_name", {
            required: "Username is required",
            pattern: usernamePattern,
            maxLength: {
              value: usernameMaxLength,
              message: `Username must be at most ${usernameMaxLength} characters`,
            },
          })}
        />
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register("email", {
            required: "Email is required",
            pattern: emailPattern,
          })}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password", passwordRules())}
        />
        <AuthField
          id="confirm_password"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirm_password?.message}
          {...register("confirm_password", confirmPasswordRules(getValues))}
        />
        {error ? <p className="au-error au-error--form">{error}</p> : null}
        <button
          type="submit"
          className="au-button au-button--primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating your account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  )
}

export default SignUp
