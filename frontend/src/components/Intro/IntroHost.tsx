/**
 * Puts the first-run intro up for a new account — see `features/intro/intro.ts`
 * for who gets one. Mounted once, in `_layout`.
 */
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"

import { useIsSignedIn } from "@/auth/useSession"
import { useIntroPending } from "@/features/intro/intro"

import IntroDialog from "./IntroDialog"

const IntroHost = () => {
  const isSignedIn = useIsSignedIn()
  const pending = useIntroPending()
  // The same query the feed and the cinema page read, so usually warm already.
  const { isPending: isCinemaListPending } = useFetchCinemas()
  if (!isSignedIn || !pending) return null
  // Held back until its first page has something in it. Opened straight away,
  // on a slow connection the cinema page arrived as a small, nearly empty
  // dialog — "0 of 0 selected", "Continue without saving" — and then grew into
  // the real picker a moment later, which read as a different popup flashing
  // past before the intro. An error does not hold it: `isPending` is false
  // then, and the page can still be skipped.
  if (!pending.skipCinemas && isCinemaListPending) return null
  return <IntroDialog skipCinemas={pending.skipCinemas} />
}

export default IntroHost
