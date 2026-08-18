import PrivacyPolicy from "@/components/Common/PrivacyPolicy"
/**
 * TanStack Router route module for privacy. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicy,
})
