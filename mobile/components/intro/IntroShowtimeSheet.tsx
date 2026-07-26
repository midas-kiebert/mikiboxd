/**
 * The showtime sheet the intro's tour points at, rendered over mock data.
 *
 * Mounted by `IntroFlow` *outside* its Modal on purpose: the bottom sheet
 * portals into the app's root, and a React Native Modal is a window above it —
 * so this is what makes the sheet visible behind the tour's overlay instead of
 * hidden underneath it.
 *
 * Every handler is a no-op and `tour` switches the sheet's own requests off, so
 * nothing here can touch a real showtime.
 */
import ShowtimeActionModal, {
  type ShowtimeSheetTour,
} from "@/components/showtimes/ShowtimeActionModal";
import { useDemoShowtime } from "@/components/intro/demo-showtime";

const noop = () => {};

type IntroShowtimeSheetProps = {
  visible: boolean;
  tour: ShowtimeSheetTour;
};

export default function IntroShowtimeSheet({ visible, tour }: IntroShowtimeSheetProps) {
  const demoShowtime = useDemoShowtime();

  return (
    <ShowtimeActionModal
      visible={visible}
      showtime={demoShowtime}
      isUpdatingStatus={false}
      onUpdateStatus={noop}
      onClose={noop}
      // No movie page to go to: the film is invented, and the tour is not a
      // place to navigate away from.
      disableMovieNavigation
      tour={tour}
    />
  );
}
