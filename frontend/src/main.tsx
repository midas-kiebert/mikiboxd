/**
 * Web app entry point. It configures shared storage, API auth, React Query, routing, and root providers.
 */
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { routeTree } from "./routeTree.gen"

import { ApiError, OpenAPI, installAuthRefreshInterceptor } from "shared"
import { setStorage, storage } from "shared/storage"
import { getSignedIn, setSignedIn } from "./auth/session"
import { CustomProvider } from "./components/ui/provider"

// The generated API client expects async storage helpers, so we adapt browser localStorage here.
//
// Writes to `access_token` also drive the session store, so login, social
// login, logout and the 401 handler all reach `useIsSignedIn()` through the one
// path they already share — no screen has to remember to announce a sign-in.
setStorage({
  getItem: async (key: string) => localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    localStorage.setItem(key, value)
    if (key === "access_token") setSignedIn(value !== "")
  },
  removeItem: async (key: string) => {
    localStorage.removeItem(key)
    if (key === "access_token") setSignedIn(false)
  },
})

// Configure the generated OpenAPI client once at startup.
OpenAPI.BASE = import.meta.env.VITE_API_URL
OpenAPI.TOKEN = async () => {
  return (await storage.getItem("access_token")) || ""
}
// Lets the backend attribute logins/events to a platform without any
// per-request client code (see AnalyticsEventName.LOGIN in login.py).
OpenAPI.HEADERS = { "X-Client-Platform": "web" }

const router = createRouter({
  routeTree,
  scrollRestoration: true,
})

const handleAuthFailure = () => {
  // A guest never had a session to lose, so a 401 on a query that should have
  // been gated must not throw them out of the page they are browsing. Only an
  // expired session sends anyone to the login form.
  if (!getSignedIn()) return
  setSignedIn(false)
  router.navigate({ to: "/login" })
}

// Before a 401 becomes a logout, try to transparently refresh the access token.
// Only a failed refresh falls through to handleAuthFailure above.
installAuthRefreshInterceptor(handleAuthFailure)

// Centralized API error handling keeps auth redirects consistent for every query/mutation.
const handleApiError = async (error: Error) => {
  if (error instanceof ApiError && error.status === 401) {
    if (!getSignedIn()) return
    await storage.removeItem("access_token")
    await storage.removeItem("refresh_token")
    handleAuthFailure()
  } else if (error instanceof ApiError && error.status === 403) {
    router.navigate({ to: "/forbidden", replace: true })
  }
}

// Reuse the same error handler for all queries and mutations.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleApiError,
  }),
  mutationCache: new MutationCache({
    onError: handleApiError,
  }),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CustomProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CustomProvider>
  </StrictMode>,
)
