/**
 * What the detail column of a ticket wall shows while no showtime is selected.
 *
 * A wall keeps that column reserved for good (see `FeedLayout`'s `grid`), so
 * that selecting a ticket never moves the others. Left empty it was a third of
 * the screen doing nothing, and the other ways of filling it — a filter rail
 * that widens until a showtime opens, the wall growing into the space — all
 * move every ticket on the page at exactly the moment one is picked. So the
 * column stays and carries something worth glancing at, and the showtime
 * panel takes its place when there is a selection.
 *
 * A few short lists, each a way into a screening, most urgent first: invites
 * you have not answered, screenings you are interested in that are selling
 * fast, your own list, your next plans, what friends are going to, and your
 * watchlist at your cinemas. The server picks which of them appear and how
 * many rows each gets (`useFeedOverview`), so the card no longer follows the
 * feed's loaded rows and stays put while the feed scrolls. A guest gets what
 * an account is for instead.
 *
 * Picking a row selects it exactly as clicking its ticket would; its cinema
 * tag goes to that cinema's programme, as it does on the ticket.
 *
 * Plain elements and `FeedOverviewPanel.css` for the rows, like the cards they
 * summarise; Chakra only for the card around them and the list picker, so it
 * matches the showtime panel that replaces it.
 */
import { Box } from "@chakra-ui/react"
import { Link, useRouterState } from "@tanstack/react-router"
import { memo } from "react"
import type { KeyboardEvent, ReactNode } from "react"
import type { ShowtimePublic } from "shared"
import type { FeedOverviewSectionKind } from "shared/client"

import { openNotificationPanel } from "@/components/Notifications/notification-panel"
import {
  AvatarStack,
  CinemaTagLink,
  Poster,
  SeatMark,
  TONE_PALETTE,
  Tag,
  nameOf,
  viewerTone,
  when,
} from "@/components/Showtimes/cards/card-parts"
import { PanelActionButton } from "@/components/Showtimes/detail/PanelChrome"
import { PersonAvatar } from "@/components/Showtimes/detail/PersonAvatar"
import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import {
  MenuContent,
  MenuItem,
  MenuItemGroup,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu"
import { useDayClock } from "@/features/showtimes/day-clock"
import {
  type FeedParams,
  stripDefaultFeedParams,
} from "@/features/showtimes/feed-params"
import {
  type CustomList,
  type FeedOverview,
  type FeedOverviewSection,
  showMoreTarget,
} from "@/features/showtimes/useFeedOverview"

import "./FeedOverviewPanel.css"

const TONE_LABEL = {
  going: "Going",
  interested: "Interested",
  invited: "Invited",
} as const

const SECTION_TITLE: Record<
  Exclude<FeedOverviewSectionKind, "custom">,
  string
> = {
  invited: "You're invited",
  selling_fast: "Selling fast",
  plans: "Your next plans",
  friends_going: "Friends are going",
  watchlist: "From your watchlist",
}

type FeedOverviewPanelProps = {
  /** The card's lists, or `null` for a guest. */
  overview: FeedOverview | null
  /** The feed's filters right now, for "Use these filters". */
  feedParams: FeedParams
  /** Whether anything is narrowing the feed; a list of "everything" is no list. */
  hasActiveFilters: boolean
  onSelect: (showtime: ShowtimePublic) => void
  /** "Show more": put a list's filters on the feed, like a quick filter. */
  onApplyFilters: (params: FeedParams) => void
}

const FeedOverviewPanel = ({
  overview,
  feedParams,
  hasActiveFilters,
  onSelect,
  onApplyFilters,
}: FeedOverviewPanelProps) => {
  const href = useRouterState({ select: (state) => state.location.href })

  return (
    <Box
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      boxShadow="sm"
      overflow="hidden"
    >
      {overview ? (
        <>
          {overview.sections.map((section) => (
            <OverviewSection
              key={section.kind}
              section={section}
              customList={overview.customList.list}
              holdForShowMore={overview.holdForShowMore}
              feedParams={feedParams}
              onSelect={onSelect}
              onApplyFilters={onApplyFilters}
            />
          ))}
          {!overview.isPending && overview.sections.length === 0 ? (
            <p className="mk-overview__empty mk-overview__empty--alone">
              Invites, your plans and what friends are going to show up here.
            </p>
          ) : null}
          <CustomListPicker
            customList={overview.customList}
            feedParams={feedParams}
            hasActiveFilters={hasActiveFilters}
          />
        </>
      ) : (
        <Section title="Plan cinema nights with friends">
          <p className="mk-overview__pitch">
            See which friends are going, keep your seats in one agenda and
            invite people to a screening.
          </p>
          <div className="mk-overview__buttons">
            <Link to="/signup" className="mk-overview__button">
              <PanelActionButton primary fullWidth insideLink>
                Create account
              </PanelActionButton>
            </Link>
            <Link
              to="/login"
              search={{ redirect: href }}
              className="mk-overview__button"
            >
              <PanelActionButton fullWidth insideLink>
                Sign in
              </PanelActionButton>
            </Link>
          </div>
        </Section>
      )}
    </Box>
  )
}

/** Whether applying `target` would leave the feed's filters as they are. */
const isShowing = (target: FeedParams, current: FeedParams) =>
  JSON.stringify(
    stripDefaultFeedParams(target),
    Object.keys(current).sort(),
  ) ===
  JSON.stringify(stripDefaultFeedParams(current), Object.keys(current).sort())

/** One of the server's lists, with the heading and row accessory that suit it. */
const OverviewSection = ({
  section,
  customList,
  holdForShowMore,
  feedParams,
  onSelect,
  onApplyFilters,
}: {
  section: FeedOverviewSection
  customList: CustomList | null
  holdForShowMore: (params: FeedParams) => void
  feedParams: FeedParams
  onSelect: (showtime: ShowtimePublic) => void
  onApplyFilters: (params: FeedParams) => void
}) => {
  const title =
    section.kind === "custom"
      ? (customList?.title ?? "Your list")
      : SECTION_TITLE[section.kind]
  const target = showMoreTarget(section.kind, feedParams, customList)
  // The caret points where the rest will be: left, into the feed, for a list
  // that puts its filters on it; right, away, for one that opens elsewhere.
  const action =
    target?.kind === "notifications" ? (
      <button
        type="button"
        className="mk-overview__show-more"
        onClick={openNotificationPanel}
      >
        <span>Show more</span>
        <PanelIcon.chevronRight
          className="mk-overview__show-more-icon"
          aria-hidden
        />
      </button>
    ) : target?.kind === "filters" && isShowing(target.params, feedParams) ? (
      // The feed already is this list; a button that changes nothing reads broken.
      <span className="mk-overview__show-more mk-overview__show-more--current">
        <PanelIcon.chevronLeft
          className="mk-overview__show-more-icon"
          aria-hidden
        />
        <span>Currently showing</span>
      </span>
    ) : target?.kind === "filters" ? (
      <button
        type="button"
        className="mk-overview__show-more mk-overview__show-more--into-feed"
        onClick={() => {
          holdForShowMore(target.params)
          onApplyFilters(target.params)
        }}
      >
        <PanelIcon.chevronLeft
          className="mk-overview__show-more-icon"
          aria-hidden
        />
        <span>Show more</span>
      </button>
    ) : null

  return (
    <Section title={title} footer={action}>
      {section.showtimes.map((showtime) => (
        <OverviewRow
          key={showtime.id}
          showtime={showtime}
          onSelect={onSelect}
          accessory={<Accessory kind={section.kind} showtime={showtime} />}
          note={
            section.kind === "invited" ? (
              <InvitedByNote showtime={showtime} />
            ) : null
          }
        />
      ))}
    </Section>
  )
}

/** What each list is about, at the end of its rows. */
const Accessory = ({
  kind,
  showtime,
}: {
  kind: FeedOverviewSectionKind
  showtime: ShowtimePublic
}) => {
  switch (kind) {
    case "selling_fast":
      return <SeatMark showtime={showtime} withCount />
    case "plans": {
      const tone = viewerTone(showtime)
      return tone === "none" ? null : (
        <Tag palette={TONE_PALETTE[tone]} size="xs">
          {TONE_LABEL[tone]}
        </Tag>
      )
    }
    // An invite still shows who is interested or going, like every other
    // list: the inviter's name in this slot used to crowd those out. Who
    // invited you goes on its own line under the screening (`InvitedByNote`).
    default:
      return <AvatarStack showtime={showtime} size={28} max={5} align="end" />
  }
}

/**
 * Choosing your own list: one of your saved presets, the filters on the feed
 * right now, or none. A menu rather than anything inline, so the card never
 * grows to make room for the choice.
 */
const CustomListPicker = ({
  customList,
  feedParams,
  hasActiveFilters,
}: {
  customList: FeedOverview["customList"]
  feedParams: FeedParams
  hasActiveFilters: boolean
}) => {
  const { list, presets, setChoice } = customList
  const activePresetId =
    list?.choice.kind === "preset" ? list.choice.presetId : null

  return (
    <div className="mk-overview__custom">
      <span className="mk-overview__custom-label">
        {list ? (
          <>
            Your list: <strong>{list.title}</strong>
          </>
        ) : (
          "Add a list of your own to this card"
        )}
      </span>
      <MenuRoot positioning={{ placement: "bottom-end" }}>
        <MenuTrigger asChild>
          <button
            type="button"
            className="mk-overview__more mk-overview__custom-trigger"
          >
            <span className="mk-overview__custom-trigger-label">
              {list ? "Change" : "Choose"}
            </span>
            <PanelIcon.expandMore aria-hidden />
          </button>
        </MenuTrigger>
        <MenuContent minW="220px">
          <MenuItem
            value="current"
            disabled={!hasActiveFilters}
            pointerEvents={hasActiveFilters ? undefined : "none"}
            onClick={() => {
              if (hasActiveFilters)
                setChoice({ kind: "filters", params: { ...feedParams } })
            }}
          >
            Use the filters on now
          </MenuItem>
          {presets.length ? (
            <>
              <MenuSeparator />
              <MenuItemGroup title="Your quick filters">
                {presets.map((preset) => (
                  <MenuItem
                    key={preset.id}
                    value={`preset:${preset.id}`}
                    onClick={() =>
                      setChoice({ kind: "preset", presetId: preset.id })
                    }
                    fontWeight={
                      preset.id === activePresetId ? "semibold" : undefined
                    }
                  >
                    {preset.name}
                  </MenuItem>
                ))}
              </MenuItemGroup>
            </>
          ) : null}
          {list ? (
            <>
              <MenuSeparator />
              <MenuItem
                value="remove"
                color="fg.error"
                onClick={() => setChoice(null)}
              >
                Remove your list
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </MenuRoot>
    </div>
  )
}

const Section = ({
  title,
  footer,
  children,
}: {
  title: string
  /** "Show more", under the rows it continues. */
  footer?: ReactNode
  children: ReactNode
}) => (
  <section className="mk-overview__section">
    <header className="mk-overview__heading">
      <h3 className="mk-overview__title">{title}</h3>
    </header>
    <div className="mk-overview__rows">{children}</div>
    {footer ? <div className="mk-overview__footer">{footer}</div> : null}
  </section>
)

/** "You were invited by Anna", with Anna's avatar, under an invited row. */
const InvitedByNote = ({ showtime }: { showtime: ShowtimePublic }) => {
  const inviters = showtime.viewer?.invited_by ?? []
  if (!inviters.length) return null
  const first = nameOf(inviters[0])
  return (
    <span className="mk-overview__note">
      <PersonAvatar user={inviters[0]} size={16} />
      <span className="mk-overview__note-text">
        {inviters.length === 1
          ? `You were invited by ${first}`
          : `You were invited by ${first} and ${inviters.length - 1} more`}
      </span>
    </span>
  )
}

/** One screening: poster, title, when and where, and what the list is about. */
const OverviewRow = ({
  showtime,
  onSelect,
  accessory,
  note,
}: {
  showtime: ShowtimePublic
  onSelect: (showtime: ShowtimePublic) => void
  accessory: ReactNode
  /** A line under when and where, about this row in particular. */
  note?: ReactNode
}) => {
  // See `PortraitTicketCard`: whoever prints a day holds the day.
  useDayClock()
  const time = when(showtime)
  // A `div` acting as the button, as `TicketRoot` does: a real `<button>`
  // cannot hold the cinema tag's link.
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onSelect(showtime)
    }
  }
  return (
    <div
      className="mk-overview__row"
      // biome-ignore lint/a11y/useSemanticElements: a row of block content, which a <button> may not hold
      role="button"
      tabIndex={0}
      onClick={() => onSelect(showtime)}
      onKeyDown={handleKeyDown}
    >
      <Poster showtime={showtime} width="36px" radius="4px" />
      <span className="mk-overview__body">
        <span className="mk-overview__film">{showtime.movie.title}</span>
        <span className="mk-overview__meta">
          <span className="mk-overview__when">
            {time.dateShort} · {time.time}
          </span>
          <CinemaTagLink showtime={showtime} size="xs" />
        </span>
        {note}
      </span>
      <span className="mk-overview__accessory">{accessory}</span>
    </div>
  )
}

export default memo(FeedOverviewPanel)
