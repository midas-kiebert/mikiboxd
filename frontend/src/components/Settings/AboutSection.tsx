/**
 * About: the attribution notices and the way to the privacy policy and
 * support — the app's About card, which a guest gets too.
 */
import { Link } from "@tanstack/react-router"
import { MdChevronRight, MdMailOutline, MdPrivacyTip } from "react-icons/md"

import { SettingsSection } from "./settings-controls"
import { sectionMeta } from "./settings-sections"

const AboutSection = () => {
  const meta = sectionMeta("about")

  return (
    <SettingsSection id="about" title="About" icon={meta.icon}>
      <div className="st-card">
        <div className="st-card__body">
          <p className="st-help">
            This product uses the TMDB API but is not endorsed or certified by
            TMDB.
          </p>
          <p className="st-help">
            MiKiNO is not affiliated with Letterboxd, Cineville, or any of the
            cinemas listed on the site.
          </p>
        </div>
      </div>
      <div className="st-card">
        <Link to="/privacy" className="st-link-row">
          <MdPrivacyTip aria-hidden />
          <span className="st-link-row__label">Privacy policy</span>
          <MdChevronRight aria-hidden />
        </Link>
        <Link to="/support" className="st-link-row">
          <MdMailOutline aria-hidden />
          <span className="st-link-row__label">Contact support</span>
          <MdChevronRight aria-hidden />
        </Link>
      </div>
    </SettingsSection>
  )
}

export default AboutSection
