/**
 * The showtime panel's icons, named after the app's.
 *
 * The app draws this screen with `@expo/vector-icons/MaterialIcons`; the web
 * has the same set in `react-icons/md`, so every icon here is the *same* glyph
 * the app uses rather than the nearest Feather equivalent. That mattered enough
 * to be worth a file: the two clients were showing a slash and a cross, a star
 * and a bookmark, an eye and a "visibility", for the same three things.
 *
 * Keyed by the MaterialIcons name so the app's source is greppable from here —
 * `PanelIcon.bookmarkBorder` is `<MaterialIcons name="bookmark-border" />` in
 * `mobile/components/showtimes/ShowtimeActionModal.tsx`, and a change on one
 * side has an obvious counterpart on the other.
 *
 * `shareLink` is the single exception and is named for what it does rather than
 * for a MaterialIcons glyph, because the action it marks is not the app's.
 */
import {
  MdAddCircleOutline,
  MdArrowForward,
  MdBlock,
  MdBookmarkBorder,
  MdCancel,
  MdCheckCircle,
  MdChevronRight,
  MdClose,
  MdEdit,
  MdEventSeat,
  MdExpandMore,
  MdGroups,
  MdHelpOutline,
  MdHub,
  MdMail,
  MdMailOutline,
  MdNotificationsActive,
  MdNotificationsNone,
  MdPeople,
  MdPerson,
  MdRadioButtonChecked,
  MdRadioButtonUnchecked,
  MdSchedule,
  MdSearch,
  MdTune,
  MdVisibility,
  MdWhatshot,
} from "react-icons/md"

// The one glyph here that is not the app's, because the action is not the
// app's either: Share copies a link where the app opens a share sheet, and
// Feather's diagonal chain reads as a URL in a way Material's horizontal
// `link` does not.
import { FiLink } from "react-icons/fi"

export const PanelIcon = {
  addCircleOutline: MdAddCircleOutline,
  arrowForward: MdArrowForward,
  bookmarkBorder: MdBookmarkBorder,
  cancel: MdCancel,
  checkCircle: MdCheckCircle,
  chevronRight: MdChevronRight,
  close: MdClose,
  edit: MdEdit,
  eventSeat: MdEventSeat,
  expandMore: MdExpandMore,
  groups: MdGroups,
  helpOutline: MdHelpOutline,
  hub: MdHub,
  mail: MdMail,
  mailOutline: MdMailOutline,
  notificationsActive: MdNotificationsActive,
  notificationsNone: MdNotificationsNone,
  radioButtonChecked: MdRadioButtonChecked,
  radioButtonUnchecked: MdRadioButtonUnchecked,
  search: MdSearch,
  /** Not Material — see the import. Only the Share button uses it. */
  shareLink: FiLink,
  tune: MdTune,
} as const

/** The glyph `shared/showtimes/seat-availability-level` names, for the web. */
export const SEAT_LEVEL_ICON = {
  person: MdPerson,
  people: MdPeople,
  groups: MdGroups,
  whatshot: MdWhatshot,
  block: MdBlock,
} as const

/** The glyph `shared/friends/friend-watch-kind` names, resolved for the web. */
export const WATCH_KIND_ICON = {
  schedule: MdSchedule,
  visibility: MdVisibility,
} as const
