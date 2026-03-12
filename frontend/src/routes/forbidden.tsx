import Forbidden from "@/components/Common/Forbidden"
/**
 * TanStack Router route module for forbidden. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/forbidden")({
  component: Forbidden,
})
