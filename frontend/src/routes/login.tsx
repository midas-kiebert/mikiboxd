/**
 * TanStack Router route module for login. It connects URL state to the matching page component.
 */
import {
  Link as RouterLink,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { type SubmitHandler, useForm } from "react-hook-form"

import { AuthField, AuthShell } from "@/components/Auth/AuthShell"
import SocialSignIn from "@/components/Auth/SocialSignIn"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import type { Body_login_login_access_token as AccessToken } from "shared"
import useAuth, { isLoggedIn } from "shared/hooks/useAuth"
import { emailPattern, passwordRules } from "../utils"

export const Route = createFileRoute("/login")({
  component: Login,
  // `redirect` is where the visitor was when they were asked to sign in --
  // `useRequireAccount` and `RequireAccount` both set it, so pressing "Going" on
  // a showtime as a guest returns to that showtime rather than the home feed.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    ...(typeof search.redirect === "string"
      ? { redirect: search.redirect }
      : {}),
  }),
  beforeLoad: async ({ search }) => {
    if (await isLoggedIn()) {
      if (search.redirect) {
        throw redirect({ href: search.redirect })
      }
      throw redirect({ to: "/", search: defaultFeedParams })
    }
  },
})

function Login() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()
  // Data hooks keep this module synced with backend data and shared cache state.
  // No onLoginSuccess: it would also fire for the Apple/Google buttons, whose
  // new accounts have to go to /pick-username rather than on to `redirect`.
  const { loginMutation, socialLoginMutation, error, resetError } = useAuth()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccessToken>({
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      username: "",
      password: "",
    },
  })

  const onSubmit: SubmitHandler<AccessToken> = async (data) => {
    if (isSubmitting) return

    resetError()

    try {
      await loginMutation.mutateAsync(data)
    } catch {
      // error is handled by useAuth hook
      return
    }
    if (redirectTo) void navigate({ href: redirectTo })
    else void navigate({ to: "/", search: defaultFeedParams })
  }

  // Render/output using the state and derived values prepared above.
  return (
    <AuthShell
      title="Log in"
      lede="Welcome back. Your agenda, friends and invites are waiting."
      switchTo={{
        text: "New to MiKiNO? An account is free, and it's how you plan with friends.",
        label: "Create an account",
        to: "/signup",
      }}
    >
      <form className="au-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        <SocialSignIn
          mode="sign-in"
          socialLoginMutation={socialLoginMutation}
          resetError={resetError}
          redirectTo={redirectTo}
        />
        <AuthField
          id="username"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.username?.message}
          {...register("username", {
            required: "Email is required",
            pattern: emailPattern,
          })}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          aside={
            <RouterLink to="/recover-password" className="au-link">
              Forgot password?
            </RouterLink>
          }
          {...register("password", passwordRules())}
        />
        {error ? <p className="au-error au-error--form">{error}</p> : null}
        <button
          type="submit"
          className="au-button au-button--primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthShell>
  )
}
