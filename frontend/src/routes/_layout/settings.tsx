/**
 * TanStack Router route module for settings. The page is open to guests, as
 * the app's Settings tab is: they get the settings kept in this browser, and
 * an offer to sign in for the rest (see `Settings/SettingsPage.tsx`). A
 * section is addressed by the URL's hash, e.g. `/settings#privacy`.
 */
import { createFileRoute } from "@tanstack/react-router"

import DeferredPage from "@/components/Common/DeferredPage"
import SettingsPage from "@/components/Settings/SettingsPage"

export const Route = createFileRoute("/_layout/settings")({
  component: SettingsRoute,
})

function SettingsRoute() {
  return (
    <DeferredPage>
      <SettingsPage />
    </DeferredPage>
  )
}
