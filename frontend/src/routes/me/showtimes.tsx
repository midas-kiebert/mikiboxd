import { createFileRoute, } from "@tanstack/react-router";
import MyShowtimesPage from "@/components/Showtimes/MyShowtimesPage";

//@ts-ignore
export const Route = createFileRoute("/me/showtimes")({
    component: MyShowtimesPage,
});
