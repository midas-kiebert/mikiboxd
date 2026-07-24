/**
 * Admin feature component: AdminGuard. Renders Forbidden for non-superusers.
 */
import type { ReactNode } from "react"

import Forbidden from "@/components/Common/Forbidden"
import useAuth from "shared/hooks/useAuth"

const AdminGuard = ({ children }: { children: ReactNode }) => {
  const { user: currentUser } = useAuth()

  if (!currentUser) {
    return null
  }
  if (!currentUser.is_superuser) {
    return <Forbidden />
  }
  return <>{children}</>
}

export default AdminGuard
