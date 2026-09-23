/**
 * What the Activity page's side column shows while no screening is open.
 *
 * The column is reserved for the showtime panel for good, like the feed's:
 * opening and closing it would resize the list, and a resized list refolds
 * every row's columns at the moment one is picked. So while it is empty it
 * says something about the list beside it:
 *
 *   - your next plan, one press from opening it;
 *   - invites you have not answered;
 *   - which friends are behind the most of it, each a way into their own
 *     agenda.
 *
 * Every number is the server's, over the whole list
 * (`GET /me/activity/summary`), so none of them grows as the list scrolls and
 * loads more rows. Until the summary arrives the column holds only the hint,
 * rather than a count that would change under the reader.
 */
import { Link } from "@tanstack/react-router"
import { memo } from "react"
import type { ActivitySummaryPublic, ShowtimePublic } from "shared"

import {
  AvatarDot,
  Poster,
  nameOf,
  when,
} from "@/components/Showtimes/cards/card-parts"
import { useDayClock } from "@/features/showtimes/day-clock"
import { friendFeedSearch } from "@/features/showtimes/feed-params"

import type { ActivityMode } from "./activity-modes"

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`

type ActivitySummaryProps = {
  mode: ActivityMode
  summary: ActivitySummaryPublic | null
  onSelect: (showtime: ShowtimePublic) => void
}

const SummaryShowtime = ({
  showtime,
  onSelect,
}: {
  showtime: ShowtimePublic
  onSelect: (showtime: ShowtimePublic) => void
}) => {
  useDayClock()
  const time = when(showtime)
  return (
    <button
      type="button"
      className="ac-sum__plan"
      onClick={() => onSelect(showtime)}
    >
      <Poster showtime={showtime} width="40px" radius="4px" />
      <span className="ac-sum__plan-body">
        <span className="ac-sum__plan-title">{showtime.movie.title}</span>
        <span className="ac-sum__plan-when">
          {time.dateShort} · {time.time} · {showtime.cinema.name}
        </span>
      </span>
    </button>
  )
}

const ActivitySummary = ({ mode, summary, onSelect }: ActivitySummaryProps) => {
  const hint = (
    <p className="ac-sum__hint">
      Pick a screening to see who's going, set your status or invite friends.
    </p>
  )
  if (!summary) return <div className="ac-sum">{hint}</div>

  const {
    next_plan: nextPlan,
    plan_count: planCount,
    invites,
    invite_count: inviteCount,
  } = summary

  return (
    <div className="ac-sum">
      {mode === "friends" ? null : (
        <section className="ac-sum__section">
          <h2 className="ac-sum__heading">Your next plan</h2>
          {nextPlan ? (
            <>
              <SummaryShowtime showtime={nextPlan} onSelect={onSelect} />
              <p className="ac-sum__note">
                {planCount > 1
                  ? `${plural(planCount - 1, "more plan")} after this one.`
                  : "Your only plan so far."}
              </p>
            </>
          ) : (
            <p className="ac-sum__note">
              Nothing marked yet. Open a screening and say you're going or
              interested.
            </p>
          )}
        </section>
      )}

      {inviteCount > 0 ? (
        <section className="ac-sum__section">
          <h2 className="ac-sum__heading">
            Waiting for your answer{" "}
            <span className="ac-sum__count">{inviteCount}</span>
          </h2>
          {invites.map((showtime) => (
            <SummaryShowtime
              key={showtime.id}
              showtime={showtime}
              onSelect={onSelect}
            />
          ))}
          {inviteCount > invites.length ? (
            <p className="ac-sum__note">
              {plural(inviteCount - invites.length, "more invite")} in the list.
            </p>
          ) : null}
        </section>
      ) : null}

      {mode === "you" ? null : (
        <section className="ac-sum__section">
          <h2 className="ac-sum__heading">Most active friends</h2>
          {summary.friends.length ? (
            <div className="ac-sum__friends">
              {summary.friends.map(({ user, going, interested }) => (
                <Link
                  key={user.id}
                  to="/"
                  search={friendFeedSearch(user.id)}
                  className="ac-sum__friend"
                  title={`${nameOf(user)}'s agenda`}
                >
                  <AvatarDot
                    user={user}
                    kind={going ? "going" : "interested"}
                    size={28}
                  />
                  <span className="ac-sum__friend-name">{nameOf(user)}</span>
                  <span className="ac-sum__friend-counts">
                    {going ? (
                      <span className="ac-sum__going">{going} going</span>
                    ) : null}
                    {interested ? (
                      <span className="ac-sum__interested">
                        {interested} interested
                      </span>
                    ) : null}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="ac-sum__note">
              None of your friends have marked anything yet.
            </p>
          )}
        </section>
      )}

      {hint}
    </div>
  )
}

export default memo(ActivitySummary)
