/**
 * Puts the first-run intro up for a new account — see `features/intro/intro.ts`
 * for who gets one. Mounted once, in `_layout`.
 */
import { useIsSignedIn } from "@/auth/useSession"
import { useIntroPending } from "@/features/intro/intro"

import IntroDialog from "./IntroDialog"

const IntroHost = () => {
  const isSignedIn = useIsSignedIn()
  const pending = useIntroPending()
  if (!isSignedIn || !pending) return null
  return <IntroDialog skipCinemas={pending.skipCinemas} />
}

export default IntroHost
