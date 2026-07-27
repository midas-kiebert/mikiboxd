/**
 * Wraps a navigation callback so a double-tap can only fire it once.
 *
 * expo-router's `push`/`replace` are async and re-renders that would disable
 * a button lag behind a fast double-tap, so both taps land before the first
 * navigation takes effect — stacking the destination screen twice. The guard
 * resets when this screen regains focus (e.g. the user came back), so it
 * doesn't need the navigation call itself to resolve.
 */
import { useCallback, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

export function useSingleFireNavigation<Args extends unknown[]>(
    navigate: (...args: Args) => void
) {
    const hasFiredRef = useRef(false)

    useFocusEffect(
        useCallback(() => {
            hasFiredRef.current = false
        }, [])
    )

    return useCallback(
        (...args: Args) => {
            if (hasFiredRef.current) return
            hasFiredRef.current = true
            navigate(...args)
        },
        [navigate]
    )
}
