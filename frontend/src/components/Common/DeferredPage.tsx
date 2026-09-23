/**
 * Switch tabs now, build the page a frame later.
 *
 * TanStack Router runs every navigation inside `React.startTransition`, and a
 * transition keeps the old page on screen until the new one has rendered in
 * full. So a heavy page (Friends, Activity, the feed) left you staring at the
 * tab you were leaving for as long as the new one took to build — the switch
 * felt sluggish even though nothing was being fetched.
 *
 * This wrapper commits a spinner first, which is cheap enough to land at once,
 * then mounts the real page after the browser has painted it. The page build
 * then happens outside the navigation's transition, behind a loading state.
 */
import { Center, Spinner } from "@chakra-ui/react"
import { type ReactNode, useEffect, useState } from "react"

const DeferredPage = ({ children }: { children: ReactNode }) => {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // Two frames: the first rAF runs before the spinner's paint, the second
    // after it, so the spinner is actually on screen before the heavy commit.
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setIsReady(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  if (isReady) return <>{children}</>
  return (
    <Center py={16}>
      <Spinner size="lg" color="fg.muted" />
    </Center>
  )
}

export default DeferredPage
