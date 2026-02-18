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

import { ApiError, OpenAPI } from "shared"
import { CustomProvider } from "./components/ui/provider"
import { setStorage, storage } from "shared/storage"

// The generated API client expects async storage helpers, so we adapt browser localStorage here.
setStorage({
  getItem: async (key: string) => localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    localStorage.setItem(key, value)
  },
  removeItem: async (key: string) => {
    localStorage.removeItem(key)
  },
})


// Configure the generated OpenAPI client once at startup.
OpenAPI.BASE = import.meta.env.VITE_API_URL
OpenAPI.TOKEN = async () => {
  return (await storage.getItem("access_token")) || ""
}

const router = createRouter({
  routeTree,
  scrollRestoration: true,
});

// Centralized API error handling keeps auth redirects consistent for every query/mutation.
const handleApiError = async (error: Error) => {
  if (error instanceof ApiError && error.status === 401) {
    await storage.removeItem("access_token")
    router.navigate({ to: "/login" })
  } else if (error instanceof ApiError && error.status === 403) {
    router.navigate({ to: "/forbidden", replace: true})
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
