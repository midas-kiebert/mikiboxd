import { createFileRoute } from "@tanstack/react-router";
import FriendsPage from "@/components/Friends/FriendsPage";

//@ts-ignore
export const Route = createFileRoute("/_layout/friends")({
    component: FriendsPage,
});
