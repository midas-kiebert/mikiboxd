/**
 * TanStack Router route module for pick-username: the one step between a new
 * Apple/Google sign-in and the site.
 *
 * The backend creates a social account without a username, so the first
 * sign-in lands here instead of on `redirect`. Everything the email signup does
 * after creating an account happens here too, once the name is saved: the
 * guest's preferred cinemas are carried over, the theme starts from the
 * system's, and the intro is queued.
 */
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useTheme } from "next-themes"
import { type SubmitHandler, useForm } from "react-hook-form"
import { type ApiError, MeService } from "shared"
import { saveSelectionAsPreferred } from "shared/filters/cinema-presets"
import { isLoggedIn } from "shared/hooks/useAuth"
import { handleError } from "shared/utils"

import { AuthField, AuthShell } from "@/components/Auth/AuthShell"
import { markIntroPending } from "@/features/intro/intro"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import { claimGuestPreferredCinemas } from "@/features/showtimes/guest-preferred-cinemas"
import { usernameMaxLength, usernamePattern } from "@/utils"

type PickUsernameSearch = { suggestion?: string; redirect?: string }

export const Route = createFileRoute("/pick-username")({
  component: PickUsername,
  validateSearch: (search: Record<string, unknown>): PickUsernameSearch => ({
    ...(typeof search.suggestion === "string"
      ? { suggestion: search.suggestion }
      : {}),
    ...(typeof search.redirect === "string"
      ? { redirect: search.redirect }
      : {}),
  }),
  beforeLoad: async () => {
    if (!(await isLoggedIn())) throw redirect({ to: "/login" })
  },
})

/**
 * A provider name like "Jan de Vries" is not a valid username; this only makes
 * a starting point the user can edit or replace.
 */
const suggestUsername = (rawName: string | undefined): string =>
  (rawName ?? "").replace(/[^A-Za-z0-9_]/g, "").slice(0, usernameMaxLength)

type PickUsernameForm = { display_name: string }

function PickUsername() {
  // Read flow: route state and data hooks first, then handlers, then page JSX.
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setTheme } = useTheme()
  const { suggestion, redirect: redirectTo } = Route.useSearch()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PickUsernameForm>({
    mode: "onBlur",
    defaultValues: { display_name: suggestUsername(suggestion) },
  })

  const onSubmit: SubmitHandler<PickUsernameForm> = async (data) => {
    if (isSubmitting) return
    try {
      const updatedUser = await MeService.updateUserMe({
        requestBody: { display_name: data.display_name },
      })
      queryClient.setQueryData(["currentUser"], updatedUser)
    } catch (error) {
      setError("display_name", { message: handleError(error as ApiError) })
      return
    }

    // As in /signup: a new account starts from the guest's system theme, not
    // whatever an earlier member of this browser chose.
    setTheme("system")
    const guestCinemaIds = claimGuestPreferredCinemas()
    if (guestCinemaIds.length > 0) {
      await saveSelectionAsPreferred({ cinemaIds: guestCinemaIds }).catch(
        () => undefined,
      )
    }
    markIntroPending({ skipCinemas: guestCinemaIds.length > 0 })
    if (redirectTo) void navigate({ href: redirectTo })
    else void navigate({ to: "/", search: defaultFeedParams })
  }

  // Render/output using the state and derived values prepared above.
  return (
    <AuthShell
      title="Pick a username"
      lede="It's how friends find you and what they see next to your plans. You can change it later in Settings."
    >
      <form className="au-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        <AuthField
          id="display_name"
          label="Username"
          autoComplete="username"
          autoFocus
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
        <button
          type="submit"
          className="au-button au-button--primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving…" : "Continue"}
        </button>
      </form>
    </AuthShell>
  )
}

export default PickUsername
