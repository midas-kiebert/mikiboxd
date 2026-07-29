import Support from "@/components/Common/Support"
/**
 * TanStack Router route module for support. It connects URL state to the matching page component.
 */
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/support")({
  component: Support,
})
