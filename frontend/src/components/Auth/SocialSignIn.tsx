/**
 * "Continue with Apple / Google" at the top of the login and signup cards,
 * with the divider that separates them from the email form.
 *
 * The web twin of the app's `SocialSignInSection`: same endpoint, same two
 * outcomes. A provider identity the backend has never seen creates an account
 * with no username, which detours through /pick-username before anything else;
 * one it knows (or can link by verified email) is simply signed in. Which page
 * the buttons sit on only changes their wording.
 *
 * Both buttons are drawn in the page's own style. Identity Services only hands
 * out ID tokens through the button it renders itself, whose iframe brings its
 * own box and colours — so Google's real button is laid invisibly over ours:
 * the click lands on Google's, the eye sees ours.
 */
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { FaApple } from "react-icons/fa"
import type { AuthHook } from "shared/types"

import { toaster } from "@/components/ui/toaster"
import { defaultFeedParams } from "@/features/showtimes/feed-params"

import {
  appleClientId,
  googleClientId,
  loadApple,
  loadGoogle,
} from "./social-sdk"

type Provider = "apple" | "google"

const PROVIDER_LABEL: Record<Provider, string> = {
  apple: "Apple",
  google: "Google",
}

/** Google's button takes a pixel width, capped by Google at 400. */
const GOOGLE_BUTTON_MAX_WIDTH = 400
/** Google's "large" button height, which the scale to the slot is taken from. */
const GOOGLE_BUTTON_HEIGHT = 44

type SocialSignInProps = {
  mode: "sign-in" | "sign-up"
  socialLoginMutation: AuthHook["socialLoginMutation"]
  resetError: () => void
  /** Where to go once signed in; the feed when absent. */
  redirectTo?: string
}

/** Google's four-colour "G", which its brand rules require on the button. */
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
)

const SocialSignIn = ({
  mode,
  socialLoginMutation,
  resetError,
  redirectTo,
}: SocialSignInProps) => {
  // Read flow: local state first, then the handlers, then the JSX.
  const navigate = useNavigate()
  const googleSlotRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Provider | null>(null)
  const [googleFailed, setGoogleFailed] = useState(false)

  // Held in a ref so Google's callback, registered once, always sees the
  // current props rather than those of the render that registered it.
  const finishRef = useRef<
    (
      provider: Provider,
      token: string,
      name?: string,
      code?: string,
    ) => Promise<void>
  >(async () => undefined)
  finishRef.current = async (provider, token, name, code) => {
    resetError()
    setPending(provider)
    let result: { needsUsername: boolean; passwordRemoved: boolean }
    try {
      result = await socialLoginMutation.mutateAsync({
        provider,
        token,
        ...(code ? { authorization_code: code } : {}),
      })
    } catch {
      // `useAuth` has put the message in `error`, which the card shows.
      setPending(null)
      return
    }
    // Linking a provider to an account whose address was never confirmed drops
    // that account's password — never let that happen silently.
    if (result.passwordRemoved) {
      toaster.create({
        title: `Signing in with ${PROVIDER_LABEL[provider]} from now on`,
        description: `Your account's email was never confirmed, so its password has been removed. Use ${PROVIDER_LABEL[provider]}, or set a new password with "Forgot password?".`,
        type: "info",
        duration: 12000,
      })
    }
    if (result.needsUsername) {
      void navigate({
        to: "/pick-username",
        search: {
          ...(name ? { suggestion: name } : {}),
          ...(redirectTo ? { redirect: redirectTo } : {}),
        },
      })
      return
    }
    if (redirectTo) void navigate({ href: redirectTo })
    else void navigate({ to: "/", search: defaultFeedParams })
  }

  useEffect(() => {
    const slot = googleSlotRef.current
    if (!googleClientId || !slot) return
    let cancelled = false
    let observer: ResizeObserver | null = null
    loadGoogle()
      .then((google) => {
        if (cancelled) return
        google.initialize({
          client_id: googleClientId as string,
          ux_mode: "popup",
          use_fedcm_for_button: true,
          callback: ({ credential }) => {
            void finishRef.current("google", credential)
          },
        })
        // Google's button is a fixed pixel width, at most 400, and resizing its
        // box does not widen what is clickable inside the iframe. So it is drawn
        // at the slot's width (or 400) and scaled to cover the slot exactly —
        // redrawn whenever the card changes width.
        let renderedWidth = 0
        const fit = () => {
          const width = Math.round(slot.clientWidth)
          if (width === 0) return
          const target = Math.min(GOOGLE_BUTTON_MAX_WIDTH, width)
          if (target !== renderedWidth) {
            renderedWidth = target
            slot.replaceChildren()
            google.renderButton(slot, {
              type: "standard",
              theme: "outline",
              size: "large",
              text: mode === "sign-up" ? "signup_with" : "continue_with",
              shape: "rectangular",
              logo_alignment: "center",
              width: target,
            })
          }
          const scaleX = width / renderedWidth
          const scaleY = slot.clientHeight / GOOGLE_BUTTON_HEIGHT
          slot.style.setProperty("--au-google-scale", `${scaleX}, ${scaleY}`)
        }
        fit()
        observer = new ResizeObserver(fit)
        observer.observe(slot)
      })
      .catch(() => {
        if (!cancelled) setGoogleFailed(true)
      })
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [mode])

  const handleApple = async () => {
    if (!appleClientId || pending) return
    resetError()
    setPending("apple")
    try {
      const apple = await loadApple(appleClientId)
      const response = await apple.signIn()
      const name = [
        response.user?.name?.firstName,
        response.user?.name?.lastName,
      ]
        .filter(Boolean)
        .join(" ")
      await finishRef.current(
        "apple",
        response.authorization.id_token,
        name || undefined,
        response.authorization.code,
      )
    } catch (appleError) {
      // Closing the popup rejects with `{ error: "popup_closed_by_user" }`;
      // that, like any SDK failure before the backend call, is not worth a
      // banner — the button simply comes back.
      console.log("Apple sign-in did not complete", appleError)
      setPending(null)
    }
  }

  const verb = mode === "sign-up" ? "Sign up" : "Continue"

  // Render/output using the state and handlers prepared above.
  if (!appleClientId && !googleClientId) return null

  return (
    <div className="au-social" aria-busy={pending !== null}>
      {appleClientId ? (
        <button
          type="button"
          className="au-button au-provider"
          onClick={handleApple}
          disabled={pending !== null}
        >
          <FaApple size={18} aria-hidden className="au-provider__apple" />
          <span className="au-provider__label">
            {pending === "apple" ? "Signing in…" : `${verb} with Apple`}
          </span>
        </button>
      ) : null}
      {googleClientId && !googleFailed ? (
        <div className={pending ? "au-google au-google--blocked" : "au-google"}>
          <div className="au-button au-provider" aria-hidden>
            <GoogleMark />
            <span className="au-provider__label">
              {pending === "google" ? "Signing in…" : `${verb} with Google`}
            </span>
          </div>
          {/* Google's own button, invisible, on top: it takes the click. */}
          <div ref={googleSlotRef} className="au-google__sdk" />
        </div>
      ) : null}
      <div className="au-divider">
        <span>
          {mode === "sign-up"
            ? "or sign up with email"
            : "or continue with email"}
        </span>
      </div>
    </div>
  )
}

export default SocialSignIn
