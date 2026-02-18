/**
 * TanStack Router route module for me / showtimes. It connects URL state to the matching page component.
 */
import { createFileRoute, } from "@tanstack/react-router";
import MyShowtimesPage from "@/components/Showtimes/MyShowtimesPage";

//@ts-ignore
export const Route = createFileRoute("/_layout/me/showtimes")({
    component: MyShowtimesPage,
});
