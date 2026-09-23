/**
 * The counts that ride on the primary nav as badges, resolved once for both the
 * sidebar and the bottom bar.
 *
 * Every count belongs to an account, so for a guest these are not merely zero —
 * the queries behind them would 401 on a loop. `useIsSignedIn` answers
 * synchronously (the session is primed in `_layout`), so nothing polls until
 * there is someone to poll for. Same reasoning as the app's tab layout.
 */
import { useFetchNotificationUnseenCount } from "shared/hooks/useFetchNotificationUnseenCount"
import { useFetchReceivedRequests } from "shared/hooks/useFetchReceivedRequests"

import { useIsSignedIn } from "@/auth/useSession"
import type { NavBadge } from "@/components/Common/nav-items"

export type NavBadgeCounts = Record<NavBadge, number>

export const useNavBadgeCounts = (): NavBadgeCounts => {
  const isSignedIn = useIsSignedIn()

  // The count endpoint has existed all along and the website never showed it,
  // so an invite waiting for you was invisible until you went looking.
  const { data: unseenCount = 0 } = useFetchNotificationUnseenCount({
    enabled: isSignedIn,
  })
  const { data: receivedRequests } = useFetchReceivedRequests({
    enabled: isSignedIn,
  })

  return {
    notifications: unseenCount,
    friendRequests: receivedRequests?.length ?? 0,
  }
}
