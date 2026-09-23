/**
 * The first-run intro on the website — the app's `IntroFlow`, as a dialog.
 *
 * Same pages and the same words, minus two that have no web counterpart:
 * the spotlight tour over a live showtime sheet becomes one page that shows
 * the three status buttons and says what each is for, and the notifications
 * page is dropped (the website sends no push notifications).
 *
 *   cinemas → Letterboxd → your status → friends
 *
 * The cinemas page is skipped when the visitor had saved preferred cinemas as
 * a guest: the signup carried them over (see `routes/signup.tsx`), and asking
 * again would treat that choice as never made.
 *
 * Shown by `IntroHost` while `useIntroPending()` says so; skipping or finishing
 * clears the flag (`endIntro`).
 */
import { Portal } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { type ReactNode, useMemo, useState } from "react"
import { MeService, type UserMe } from "shared/client"
import {
  invalidateCinemaPresets,
  saveSelectionAsPreferred,
} from "shared/filters/cinema-presets"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"
import { selectedCinemasQueryKey } from "shared/hooks/useFetchSelectedCinemas"
import useLetterboxdAvatarPreference from "shared/hooks/useLetterboxdAvatarPreference"

import { CinemaChecklist } from "@/components/Feed/CinemaChecklist"
import InviteCard from "@/components/Friends/InviteCard"
import { LetterboxdNotFoundWarning } from "@/components/Settings/LetterboxdNotFoundWarning"
import { PersonAvatar } from "@/components/Showtimes/detail/PersonAvatar"
import ShowtimeStatusControl from "@/components/Showtimes/detail/ShowtimeStatusControl"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import {
  DialogBackdrop,
  DialogBody,
  DialogContent,
  DialogRoot,
} from "@/components/ui/dialog"
import { endIntro } from "@/features/intro/intro"
import { defaultFeedParams } from "@/features/showtimes/feed-params"
import useCustomToast from "@/hooks/useCustomToast"

import "@/components/Auth/auth.css"
import "@/components/Friends/friends.css"
import "./intro.css"

type IntroPageId = "cinemas" | "letterboxd" | "status" | "friends"

const ALL_PAGES: readonly IntroPageId[] = [
  "cinemas",
  "letterboxd",
  "status",
  "friends",
]

const IntroDialog = ({ skipCinemas }: { skipCinemas: boolean }) => {
  const pages = useMemo(
    () =>
      skipCinemas ? ALL_PAGES.filter((page) => page !== "cinemas") : ALL_PAGES,
    [skipCinemas],
  )
  const [index, setIndex] = useState(0)
  const pageId = pages[index]
  const next = () =>
    index + 1 < pages.length ? setIndex(index + 1) : endIntro()

  return (
    <DialogRoot
      open
      placement="center"
      size="lg"
      closeOnInteractOutside={false}
      // The page's title, not "Skip tutorial": the first thing focused should
      // be what the page says, and a ring on Skip reads as a suggestion.
      initialFocusEl={() => document.querySelector<HTMLElement>(".in-title")}
      onOpenChange={(details) => {
        if (!details.open) endIntro()
      }}
    >
      <Portal>
        {/* Blurred rather than just dimmed: the intro is the only thing to do. */}
        <DialogBackdrop className="in-backdrop" />
        <DialogContent className="in-dialog" backdrop={false}>
          <DialogBody p={0}>
            <div className="in-chrome">
              <div
                className="in-progress"
                aria-label={`Step ${index + 1} of ${pages.length}`}
              >
                {pages.map((page, position) => (
                  <span
                    key={page}
                    className={
                      position <= index ? "in-dot in-dot--on" : "in-dot"
                    }
                  />
                ))}
              </div>
              <button type="button" className="in-skip" onClick={endIntro}>
                Skip tutorial
              </button>
            </div>
            {/* Keyed, so a page's own state starts fresh when it arrives. */}
            <div key={pageId} className="in-page">
              {pageId === "cinemas" ? <CinemasPage onDone={next} /> : null}
              {pageId === "letterboxd" ? (
                <LetterboxdPage onDone={next} />
              ) : null}
              {pageId === "status" ? <StatusPage onDone={next} /> : null}
              {pageId === "friends" ? <FriendsPage onDone={next} /> : null}
            </div>
          </DialogBody>
        </DialogContent>
      </Portal>
    </DialogRoot>
  )
}

/** The app's `IntroPageShell`: a title, a line under it, the page, its buttons. */
const PageShell = ({
  title,
  message,
  children,
  primaryLabel,
  onPrimary,
  primaryBusy = false,
  secondaryLabel,
  onSecondary,
}: {
  title: string
  message: string
  children?: ReactNode
  primaryLabel: string
  onPrimary: () => void
  primaryBusy?: boolean
  secondaryLabel?: string
  onSecondary?: () => void
}) => (
  <>
    <h2 className="in-title" tabIndex={-1}>
      {title}
    </h2>
    <p className="in-message">{message}</p>
    {children ? <div className="in-body">{children}</div> : null}
    <div className="in-actions">
      {secondaryLabel && onSecondary ? (
        <button type="button" className="au-button" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      ) : null}
      <button
        type="button"
        className="au-button au-button--primary"
        onClick={onPrimary}
        disabled={primaryBusy}
      >
        {primaryLabel}
      </button>
    </div>
  </>
)

/**
 * Every cinema starts ticked: "0 of N selected" on a new account's first
 * screen reads as a filter already hiding everything, and narrowing a list
 * down is a smaller ask than building one up. Nothing ticked saves nothing.
 */
const CinemasPage = ({ onDone }: { onDone: () => void }) => {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const { data: cinemas = [] } = useFetchCinemas()
  const [deselected, setDeselected] = useState<ReadonlySet<number>>(new Set())
  const selectedIds = useMemo(
    () =>
      new Set(
        cinemas.map((cinema) => cinema.id).filter((id) => !deselected.has(id)),
      ),
    [cinemas, deselected],
  )
  const isAllSelected = selectedIds.size === cinemas.length

  const save = useMutation({
    mutationFn: (cinemaIds: number[]) =>
      saveSelectionAsPreferred({ cinemaIds }),
    onSuccess: () => {
      invalidateCinemaPresets(queryClient)
      queryClient.invalidateQueries({ queryKey: selectedCinemasQueryKey })
      onDone()
    },
    onError: () =>
      showErrorToast("Your cinemas were not saved. Please try again."),
  })

  const setSelected = (ids: readonly number[], selected: boolean) =>
    setDeselected((current) => {
      const nextSet = new Set(current)
      for (const id of ids) {
        if (selected) nextSet.delete(id)
        else nextSet.add(id)
      }
      return nextSet
    })

  return (
    <PageShell
      title="Select your favorite cinemas"
      message="We'll only show you screenings at the cinemas you pick. You can change this any time."
      primaryLabel={
        save.isPending
          ? "Saving…"
          : selectedIds.size === 0
            ? "Continue without saving"
            : "Save and continue"
      }
      primaryBusy={save.isPending}
      onPrimary={() =>
        selectedIds.size === 0 ? onDone() : save.mutate([...selectedIds])
      }
    >
      <div className="in-count">
        <span>
          {selectedIds.size} of {cinemas.length} selected
        </span>
        <button
          type="button"
          className="au-link in-link-button"
          onClick={() =>
            setDeselected(
              isAllSelected
                ? new Set(cinemas.map((cinema) => cinema.id))
                : new Set(),
            )
          }
        >
          {isAllSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className="in-scroll">
        <CinemaChecklist
          cinemas={cinemas}
          selectedIds={selectedIds}
          onToggle={(id) => setSelected([id], deselected.has(id))}
          onOnly={(id) =>
            setDeselected(
              new Set(
                cinemas
                  .map((cinema) => cinema.id)
                  .filter((other) => other !== id),
              ),
            )
          }
          onSelect={(ids) => setSelected(ids, true)}
          onDeselect={(ids) => setSelected(ids, false)}
        />
      </div>
    </PageShell>
  )
}

const LetterboxdPage = ({ onDone }: { onDone: () => void }) => {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [username, setUsername] = useState("")
  const trimmed = username.trim()
  // Set once the username is saved: the account the picture question is about.
  const [savedUser, setSavedUser] = useState<UserMe | null>(null)
  // The saved name Letterboxd answered 404 for; the page stays up to fix it.
  const [notFoundUsername, setNotFoundUsername] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (value: string) =>
      MeService.updateUserMe({ requestBody: { letterboxd_username: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["currentUser"], updated)
      queryClient.invalidateQueries({ queryKey: ["showtimes"] })
      queryClient.invalidateQueries({ queryKey: ["movies"] })
      if (updated.letterboxd_account_not_found) {
        setNotFoundUsername(updated.letterboxd_username ?? null)
      } else {
        setSavedUser(updated)
      }
    },
    onError: () =>
      showErrorToast("Your Letterboxd username was not saved. Try again."),
  })

  if (savedUser)
    return <LetterboxdAvatarPrompt user={savedUser} onDone={onDone} />

  return (
    <PageShell
      title="Connect your Letterboxd"
      message="Filter screenings down to your watchlist, or hide films you have already seen."
      primaryLabel={
        save.isPending ? "Saving…" : trimmed ? "Save and continue" : "Continue"
      }
      primaryBusy={save.isPending}
      onPrimary={() => (trimmed ? save.mutate(trimmed) : onDone())}
      // Once a name has failed, the way out keeps it: the user may be about to
      // create that account, and saying they don't use Letterboxd is untrue.
      secondaryLabel={
        notFoundUsername ? "Keep it and continue" : "I don't use Letterboxd"
      }
      onSecondary={onDone}
    >
      <div className="au-field">
        <label className="au-label" htmlFor="intro-letterboxd">
          Letterboxd username
        </label>
        <div className="in-affix">
          <span className="in-affix__prefix">letterboxd.com/</span>
          <input
            id="intro-letterboxd"
            className="au-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && trimmed) save.mutate(trimmed)
            }}
            placeholder="username"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      {notFoundUsername ? (
        <LetterboxdNotFoundWarning username={notFoundUsername} />
      ) : null}
      <p className="in-help">
        <strong>Where do I find it?</strong> Open your profile on letterboxd.com
        and read the address bar: in letterboxd.com/yourname, your username is{" "}
        <em>yourname</em>.
      </p>
    </PageShell>
  )
}

/**
 * The Letterboxd page's second step, asked right after the username saves:
 * connecting Letterboxd for a watchlist is not consent to show its picture, so
 * it stays off unless the user says yes here (or later in Settings). The app
 * asks the same with a switch on its intro page and a tip after a first save
 * in Settings (`LetterboxdAvatarTip`).
 *
 * Saving the username already fetched the picture, so the preview shows it.
 * Saying yes looks again; if still none comes back (none on the account, or
 * the lookup failed) a short note says so before moving on. The switch stays
 * on, so a picture added later shows up by itself.
 */
const LetterboxdAvatarPrompt = ({
  user,
  onDone,
}: { user: UserMe; onDone: () => void }) => {
  const avatarPreference = useLetterboxdAvatarPreference()
  const pictureUrl =
    avatarPreference.pictureUrl ?? user.letterboxd_avatar_url ?? null
  // Set when saying yes brought no picture back: stays on this page to say
  // why the initial is still showing before moving on.
  const [isPictureMissing, setIsPictureMissing] = useState(false)

  if (isPictureMissing) {
    return (
      <PageShell
        title="No picture found"
        message="Your coloured initial is used for now."
        primaryLabel="Continue"
        onPrimary={onDone}
      >
        <div className="in-avatar">
          <PersonAvatar
            user={{
              id: user.id,
              display_name: user.display_name,
              avatar_url: null,
            }}
            size={112}
          />
          <div className="in-note">
            <p className="in-help">
              Letterboxd didn't give us a profile picture for{" "}
              <strong>{user.letterboxd_username}</strong>: either the account
              has none, or Letterboxd couldn't be reached just now. If you add
              one later, your avatar updates by itself.
            </p>
            <p className="in-help">
              You can change your Letterboxd username any time in Settings →
              Letterboxd.
            </p>
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="Use your Letterboxd picture?"
      message={
        pictureUrl
          ? "Show your Letterboxd profile picture to friends on MiKiNO instead of a coloured initial. It stays off unless you say so."
          : "Show your Letterboxd profile picture to friends on MiKiNO instead of a coloured initial. We'll fetch it from Letterboxd as soon as you turn this on."
      }
      primaryLabel={avatarPreference.isSaving ? "Fetching…" : "Use my picture"}
      primaryBusy={avatarPreference.isSaving}
      onPrimary={() => {
        avatarPreference
          .enable()
          .then((updated) => {
            if (updated.letterboxd_avatar_url) onDone()
            else setIsPictureMissing(true)
          })
          // The hook rolls the switch back; the intro still moves on.
          .catch(onDone)
      }}
      secondaryLabel="Not now"
      onSecondary={onDone}
    >
      <div className="in-avatar">
        <PersonAvatar
          user={{
            id: user.id,
            display_name: user.display_name,
            avatar_url: pictureUrl,
          }}
          size={112}
        />
        <p className="in-help">
          You can change this any time in Settings → Letterboxd.
        </p>
      </div>
    </PageShell>
  )
}

/** The app's three tour steps, on one page, beside the buttons they are about. */
const STATUS_STEPS = [
  {
    icon: PanelIcon.bookmarkBorder,
    tone: "orange",
    title: "Mark a screening as interested",
    message: "Your friends can see what you want to watch.",
  },
  {
    icon: PanelIcon.checkCircle,
    tone: "green",
    title: "Going? Say so",
    message: "Mark a screening as going once you have reserved a ticket.",
  },
  {
    icon: PanelIcon.mailOutline,
    tone: "blue",
    title: "You can invite friends too",
    message: "Pick a friend and they get an invite for this exact screening.",
  },
] as const

const StatusPage = ({ onDone }: { onDone: () => void }) => {
  // A live control, so pressing it shows what pressing it does — nothing saved.
  const [status, setStatus] = useState<"NOT_GOING" | "INTERESTED" | "GOING">(
    "INTERESTED",
  )
  return (
    <PageShell
      title="Plan with a click"
      message="Open any screening and these buttons are at the top. Try them."
      primaryLabel="Continue"
      onPrimary={onDone}
    >
      <ShowtimeStatusControl
        status={status}
        onChange={(pressed) =>
          setStatus(
            pressed === status || pressed === "NOT_GOING"
              ? "NOT_GOING"
              : pressed,
          )
        }
      />
      <ul className="in-steps">
        {STATUS_STEPS.map((step) => (
          <li key={step.title} className="in-step">
            <span
              className={`in-step__icon in-step__icon--${step.tone}`}
              aria-hidden
            >
              <step.icon size={18} />
            </span>
            <span>
              <span className="in-step__title">{step.title}</span>
              <span className="in-step__message">{step.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </PageShell>
  )
}

const FriendsPage = ({ onDone }: { onDone: () => void }) => {
  const navigate = useNavigate()
  return (
    <PageShell
      title="Add your friends"
      message="See each other's screenings, send invites, and keep track of who's going where."
      primaryLabel="Start browsing"
      onPrimary={() => {
        onDone()
        void navigate({ to: "/", search: defaultFeedParams })
      }}
      secondaryLabel="Find friends"
      onSecondary={() => {
        onDone()
        void navigate({ to: "/friends", search: { mode: "discover" } } as never)
      }}
    >
      <InviteCard />
    </PageShell>
  )
}

export default IntroDialog
