/**
 * TanStack Router route module for index. It connects URL state to the matching page component.
 */
import MainShowtimesPage from "@/components/Showtimes/MainShowtimesPage"
import { createFileRoute } from "@tanstack/react-router"


export const Route = createFileRoute("/_layout/")({
  component: MainShowtimesPage,
})
