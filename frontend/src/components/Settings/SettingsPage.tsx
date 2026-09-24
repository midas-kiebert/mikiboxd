/**
 * Settings: everything the app's Settings tab holds
 * (`mobile/app/(tabs)/settings.tsx`), as one page.
 *
 * The page used to be a row of eight tabs, each holding one small form, so
 * finding a setting meant guessing which tab it was behind and comparing two
 * meant clicking back and forth. Now every section is on the page, in the
 * order you would look for them — who you are, what you hear about, who sees
 * you, how the site looks, then the account itself — with an index beside it
 * (on a wide window) that follows the scroll and jumps to a section. Each
 * section has an anchor, so a link can land on one (`/settings#privacy`).
 *
 * As in the app, a guest gets the settings that belong to this browser —
 * appearance, the Cineville card, the notices — with an offer to sign in where
 * the account's would be, rather than a page that is only a sign-in prompt.
 *
 * Left out, because the website has nothing for them to control: the app's
 * feature-tip switches, the Cineville shortcut-button
 * switches, the intro replay, and the system notification settings link.
 */
import { Box } from "@chakra-ui/react"
import { Link, useRouterState } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useIsSignedIn } from "@/auth/useSession"

import AboutSection from "./AboutSection"
import { AccountSection, DangerZoneSection } from "./AccountSection"
import AppearanceSection from "./AppearanceSection"
import CinevilleSection from "./CinevilleSection"
import LetterboxdSection, {
  LETTERBOXD_USERNAME_INPUT_ID,
} from "./LetterboxdSection"
import NotificationsSection from "./NotificationsSection"
import PasswordSection from "./PasswordSection"
import { BlockedSection, PrivacySection } from "./PrivacySection"
import ProfileSection from "./ProfileSection"
import StatusesSection from "./StatusesSection"
import { findScrollParent, scrollPageTo } from "./page-scroll"
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settings-sections"

import "./settings.css"

/**
 * How far down the page's box the reading line sits: the section being read
 * is the last one whose top has scrolled above it.
 */
const READING_LINE_FRACTION = 0.4

/** How long the page has to stop scrolling before a jump's pin comes off. */
const SCROLL_SETTLE_MS = 150

/** Scrolls to a section, then focuses the field inside it, if one is named. */
const goToSection = (id: SettingsSectionId, focusId?: string) => {
  scrollPageTo(document.getElementById(id))
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true })
}

const SettingsPage = () => {
  // Read flow: account and visible sections first, then scroll tracking, then JSX.
  const isSignedIn = useIsSignedIn()

  const sections = useMemo(
    () =>
      SETTINGS_SECTIONS.filter((section) => {
        if (!isSignedIn) return section.guest
        return true
      }),
    [isSignedIn],
  )

  const [activeId, pinActive] = useSectionTracking(
    sections.map((section) => section.id),
  )

  const jumpTo = useCallback(
    (id: SettingsSectionId, focusId?: string) => {
      // The URL's hash is left alone: setting it wakes the router's own
      // hash scroll, which moves the whole layout (see `page-scroll.ts`).
      pinActive(id)
      goToSection(id, focusId)
    },
    [pinActive],
  )

  // Render/output using the state and derived values prepared above.
  return (
    <Box px={{ base: 4, md: 8, xl: 12 }} pt={{ base: 4, md: 8 }} pb={24}>
      <div className="st-page">
        <nav className="st-index" aria-label="Settings sections">
          <ul className="st-index__list">
            {sections.map((section) => {
              const Icon = section.icon
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={`st-index__link${section.danger ? " st-index__link--danger" : ""}`}
                    aria-current={activeId === section.id}
                    onClick={(event) => {
                      event.preventDefault()
                      jumpTo(section.id)
                    }}
                  >
                    <Icon className="st-index__icon" aria-hidden />
                    <span className="st-index__label">{section.label}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="st-main">
          <header className="st-head">
            <div className="st-head__titles">
              <h1 className="st-head__title">Settings</h1>
              <p className="st-head__description">
                {isSignedIn
                  ? "Your account, what you hear about, and how MiKiNO looks."
                  : "Your Cineville pass and what MiKiNO is."}
              </p>
            </div>
          </header>

          <div className="st-sections">
            {isSignedIn ? null : <GuestOffer />}
            {isSignedIn ? (
              <>
                <ProfileSection
                  onGoToPassword={() =>
                    jumpTo("password", "settings-password-new")
                  }
                />
                <PasswordSection />
                <LetterboxdSection />
                <NotificationsSection
                  onGoToLetterboxd={() =>
                    jumpTo("letterboxd", LETTERBOXD_USERNAME_INPUT_ID)
                  }
                />
                <PrivacySection />
                <BlockedSection />
                <StatusesSection />
              </>
            ) : null}
            {isSignedIn ? <AppearanceSection /> : null}
            <CinevilleSection />
            <AboutSection />
            {isSignedIn ? <AccountSection /> : null}
            {isSignedIn ? <DangerZoneSection /> : null}
          </div>
        </main>
      </div>
    </Box>
  )
}

/** The app's signed-out panel, where the account's settings would be. */
const GuestOffer = () => {
  const href = useRouterState({ select: (state) => state.location.href })
  return (
    <div className="st-guest">
      <p className="st-guest__title">Sign in for your account settings</p>
      <p className="st-help">
        Your profile, notifications, Letterboxd and privacy settings need an
        account. The ones below are kept in this browser, so they work without
        one.
      </p>
      <div className="st-actions">
        <Link
          to="/login"
          search={{ redirect: href }}
          className="st-button st-button--primary"
        >
          Log in
        </Link>
        <Link to="/signup" className="st-button">
          Sign up
        </Link>
      </div>
    </div>
  )
}

/**
 * Which section is being read, for the index: the last one whose top has
 * passed the reading line. The room `.st-sections` leaves below the last
 * section is what lets that one reach the line too. Lands on the URL's section once the page is
 * built, since the browser's own jump happened before there was anything to
 * jump to.
 *
 * `pin(id)` is for a jump from the index: the picked section is highlighted at
 * once and stays so for the whole scroll there, rather than the highlight
 * stepping through every section the scroll passes on the way. The pin comes
 * off once the scrolling has stopped.
 */
const useSectionTracking = (ids: readonly SettingsSectionId[]) => {
  const [activeId, setActiveId] = useState<SettingsSectionId | null>(
    ids[0] ?? null,
  )
  const key = ids.join(",")
  // Read once, when the page is built, not on every change of the list.
  const initialIds = useRef(ids)
  const isPinnedRef = useRef(false)
  const unpinTimerRef = useRef(0)

  // Unpins once no scroll has happened for a moment. Restarted by every scroll
  // event while pinned, and started by the pin itself for a jump that turns
  // out not to scroll at all.
  const scheduleUnpin = useCallback(() => {
    window.clearTimeout(unpinTimerRef.current)
    unpinTimerRef.current = window.setTimeout(() => {
      isPinnedRef.current = false
    }, SCROLL_SETTLE_MS)
  }, [])

  const pin = useCallback(
    (id: SettingsSectionId) => {
      isPinnedRef.current = true
      setActiveId(id)
      scheduleUnpin()
    },
    [scheduleUnpin],
  )

  useEffect(() => {
    const hash = window.location.hash.slice(1) as SettingsSectionId
    if (initialIds.current.includes(hash)) {
      pin(hash)
      scrollPageTo(document.getElementById(hash), { smooth: false })
    }
  }, [pin])

  useEffect(() => () => window.clearTimeout(unpinTimerRef.current), [])

  useEffect(() => {
    const elements = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    const scroller = findScrollParent(elements[0])
    if (!scroller) return

    let frame = 0
    const update = () => {
      frame = 0
      const box = scroller.getBoundingClientRect()
      const line = box.top + box.height * READING_LINE_FRACTION
      let current = elements[0]
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= line) current = element
      }
      if (current) setActiveId(current.id as SettingsSectionId)
    }
    const handleScroll = () => {
      if (isPinnedRef.current) {
        scheduleUnpin()
        return
      }
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    scroller.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      scroller.removeEventListener("scroll", handleScroll)
      window.cancelAnimationFrame(frame)
    }
  }, [key, scheduleUnpin])

  return [activeId, pin] as const
}

export default SettingsPage
