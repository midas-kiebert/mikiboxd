/**
 * Admin feature component: AdminGuard. Renders Forbidden for non-superusers.
 */
import type { ReactNode } from "react"

import { useIsSignedIn } from "@/auth/useSession"
import Forbidden from "@/components/Common/Forbidden"
import RequireAccount from "@/components/Common/RequireAccount"
import useAuth from "shared/hooks/useAuth"

const AdminGuard = ({ children }: { children: ReactNode }) => {
  const { user: currentUser } = useAuth()
  const isSignedIn = useIsSignedIn()

  // A guest gets the sign-in panel rather than the blank page they used to,
  // now that reaching this route no longer implies an account.
  if (!isSignedIn) {
    return <RequireAccount feature="the admin tools">{children}</RequireAccount>
  }
  if (!currentUser) {
    return null
  }
  if (!currentUser.is_superuser) {
    return <Forbidden />
  }
  return <>{children}</>
}

export default AdminGuard
