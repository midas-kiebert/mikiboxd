import { MeService } from "../client"
import type { AnalyticsEventName } from "../client"

/**
 * Fire-and-forget usage-analytics event, shared by web and mobile.
 *
 * Failures are swallowed — tracking must never break the action it's
 * attached to (e.g. sending an invite still succeeds if this call fails).
 */
const useTrackEvent = () => {
  const trackEvent = (
    name: AnalyticsEventName,
    properties?: Record<string, unknown>,
  ) => {
    MeService.recordEvent({ requestBody: { name, properties } }).catch(() => {
      // Intentionally ignored — see note above.
    })
  }

  return { trackEvent }
}

export default useTrackEvent
