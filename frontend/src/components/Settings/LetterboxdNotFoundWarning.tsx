/**
 * "There is no Letterboxd account called …": shown under the username field
 * in the intro and in Settings when the backend got a 404 for the linked
 * name. Only for a definite 404 (`letterboxd_account_not_found`), never for a
 * lookup that merely failed. The field right above it is how it gets fixed.
 * The app's `components/ui/LetterboxdNotFoundWarning.tsx`, same words.
 */
import { MdErrorOutline } from "react-icons/md"

import "./letterboxd-warning.css"

export const LetterboxdNotFoundWarning = ({
  username,
}: { username: string }) => (
  <div className="lb-warning" role="alert">
    <MdErrorOutline className="lb-warning__icon" size={18} aria-hidden />
    <div className="lb-warning__text">
      <strong className="lb-warning__title">
        There is no Letterboxd account called "{username}"
      </strong>
      <span className="lb-warning__body">
        Check the spelling and save it again. Your watchlist and avatar
        can't be loaded until it matches your account.
      </span>
    </div>
  </div>
)
