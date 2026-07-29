/**
 * Wraps a navigation callback so a double-tap can only fire it once.
 *
 * expo-router's `push`/`replace` are async and re-renders that would disable
 * a button lag behind a fast double-tap, so both taps land before the first
 * navigation takes effect — stacking the destination screen twice. The guard
 * resets when this screen regains focus (e.g. the user came back).
 *
 * `useFocusEffect` only fires for callers mounted as part of a routed screen.
 * Callers hoisted above the navigator (e.g. a modal mounted once at the root
 * layout, like ShowtimeActionModal) never blur/refocus, so that reset never
 * runs again after the first navigation — permanently latching the guard. A
 * short timeout fallback clears it regardless of mount location, without
 * weakening the double-tap protection (taps well after the push already
 * landed are legitimate new navigations, not double-taps).
 */
import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

const RESET_DELAY_MS = 1000

export function useSingleFireNavigation<Args extends unknown[]>(
    navigate: (...args: Args) => void
) {
    const hasFiredRef = useRef(false)
    const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useFocusEffect(
        useCallback(() => {
            hasFiredRef.current = false
        }, [])
    )

    useEffect(() => {
        return () => {
            if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
        }
    }, [])

    return useCallback(
        (...args: Args) => {
            if (hasFiredRef.current) return
            hasFiredRef.current = true
            if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
            resetTimeoutRef.current = setTimeout(() => {
                hasFiredRef.current = false
            }, RESET_DELAY_MS)
            navigate(...args)
        },
        [navigate]
    )
}
