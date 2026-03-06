/**
 * TanStack Router route module for pings / invites.
 */
import { createFileRoute } from "@tanstack/react-router";
import PingsPage from "@/components/Pings/PingsPage";

//@ts-ignore
export const Route = createFileRoute("/_layout/pings")({
    component: PingsPage,
});
