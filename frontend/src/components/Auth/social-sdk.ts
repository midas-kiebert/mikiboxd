/**
 * The two provider SDKs the website signs in with, loaded on demand.
 *
 * Neither is bundled: Google Identity Services and Sign in with Apple JS only
 * exist as hosted scripts, and only the login and signup pages need them — so
 * they are fetched the first time one of those pages renders its buttons, and
 * never for a visitor who only browses.
 *
 * Each provider is switched on by its client ID at build time. Unset means the
 * button is not drawn at all, rather than drawn and failing.
 */

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client"
const APPLE_SCRIPT =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"

/** The same Web OAuth client the app requests its ID tokens for. */
export const googleClientId: string | undefined =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined

/** A Services ID, grouped under the app's App ID so `sub` matches the app's. */
export const appleClientId: string | undefined =
  import.meta.env.VITE_APPLE_SERVICES_ID || undefined

/**
 * Must be listed on the Services ID in Apple's portal, and match the backend's
 * `APPLE_WEB_REDIRECT_URI` exactly — the popup flow never navigates to it, but
 * Apple checks it both when signing in and when the code is exchanged.
 */
export const appleRedirectUri: string =
  import.meta.env.VITE_APPLE_REDIRECT_URI || `${window.location.origin}/login`

const loaded = new Map<string, Promise<void>>()

const loadScript = (src: string): Promise<void> => {
  const existing = loaded.get(src)
  if (existing) return existing
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Let a later visit to the page try again, e.g. after a network blip.
      loaded.delete(src)
      reject(new Error(`Could not load ${src}`))
    }
    document.head.appendChild(script)
  })
  loaded.set(src, promise)
  return promise
}

// Only the parts of each SDK this site calls.

export type GoogleCredentialResponse = { credential: string }

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    ux_mode?: "popup"
    use_fedcm_for_button?: boolean
  }) => void
  renderButton: (
    parent: HTMLElement,
    options: {
      type: "standard"
      theme: "outline" | "filled_black"
      size: "large"
      text: "signin_with" | "signup_with" | "continue_with"
      shape: "rectangular"
      logo_alignment: "center"
      width: number
    },
  ) => void
}

export type AppleSignInResponse = {
  authorization: { id_token: string; code: string }
  /** Only on the very first authorization for this client. */
  user?: { name?: { firstName?: string; lastName?: string } }
}

type AppleIdAuth = {
  init: (config: {
    clientId: string
    scope: string
    redirectURI: string
    usePopup: true
  }) => void
  signIn: () => Promise<AppleSignInResponse>
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
    AppleID?: { auth: AppleIdAuth }
  }
}

export const loadGoogle = async (): Promise<GoogleAccountsId> => {
  await loadScript(GOOGLE_SCRIPT)
  const api = window.google?.accounts.id
  if (!api) throw new Error("Google Identity Services did not initialise")
  return api
}

let appleInitialised = false

export const loadApple = async (clientId: string): Promise<AppleIdAuth> => {
  await loadScript(APPLE_SCRIPT)
  const api = window.AppleID?.auth
  if (!api) throw new Error("Sign in with Apple JS did not initialise")
  if (!appleInitialised) {
    api.init({
      clientId,
      scope: "name email",
      redirectURI: appleRedirectUri,
      usePopup: true,
    })
    appleInitialised = true
  }
  return api
}
