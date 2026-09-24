/**
 * Letterboxd: the linked username, what it syncs, and your lists — the app's
 * `components/settings/LetterboxdSection.tsx`, plus the list management the
 * website already had.
 *
 * Watchlist and watched sync independently on the backend (separate cooldowns,
 * separate failures), so each has its own refresh, its own "last synced" and
 * its own failure line: one list being throttled never blocks the other. The
 * refresh greys out for the cooldown the backend reports, rather than one
 * re-derived here, so the two cannot drift. The caption only ever says when
 * the last sync was.
 *
 * A linked name Letterboxd answers 404 for gets a warning under the field
 * (the backend looks it up on every save, and again when a sync fails).
 *
 * Emptying the username and saving unlinks it, which is why this does not use
 * the shared hook that only accepts a name.
 *
 * "Use my profile picture" is an opt-in, off by default: connecting Letterboxd
 * for a watchlist is not consent to show its picture to friends.
 *
 * Lists are what the feed can filter by and the digest can follow. Curated
 * lists belong to everyone, so they are shown but have no remove button.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { DateTime } from "luxon"
import { useEffect, useState } from "react"
import { MdAdd, MdSync } from "react-icons/md"
import { MeService } from "shared/client"
import useAuth from "shared/hooks/useAuth"
import useLetterboxdAvatarPreference from "shared/hooks/useLetterboxdAvatarPreference"
import {
  useFetchLetterboxdLists,
  useLetterboxdListMutations,
} from "shared/hooks/useLetterboxdLists"

import { FriendButton } from "@/components/Friends/friend-controls"
import useCustomToast from "@/hooks/useCustomToast"

import { LetterboxdNotFoundWarning } from "./LetterboxdNotFoundWarning"

import {
  SettingsField,
  SettingsRow,
  SettingsSection,
  Switch,
} from "./settings-controls"
import { sectionMeta } from "./settings-sections"

export const LETTERBOXD_USERNAME_INPUT_ID = "settings-letterboxd-username"

/** Keeps "synced 3 min ago" and the cooldown countdown live. */
const CLOCK_TICK_MS = 30_000

const formatSynced = (iso: string | null | undefined): string => {
  if (!iso) return "Not synced recently"
  const relative = DateTime.fromISO(iso).toRelative({ style: "short" })
  return relative ? `Last synced ${relative}` : "Last synced just now"
}

const isCoolingDown = (
  endsAt: string | null | undefined,
  now: DateTime,
): boolean => Boolean(endsAt) && DateTime.fromISO(endsAt as string) > now

const LetterboxdSection = () => {
  // Read flow: account and clock first, then the writes, then JSX.
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const meta = sectionMeta("letterboxd")
  const avatarPreference = useLetterboxdAvatarPreference()

  const [username, setUsername] = useState("")
  const [syncedUsername, setSyncedUsername] = useState<
    string | null | undefined
  >(undefined)
  if (user && user.letterboxd_username !== syncedUsername) {
    setSyncedUsername(user.letterboxd_username)
    setUsername(user.letterboxd_username ?? "")
  }

  const [now, setNow] = useState(() => DateTime.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(DateTime.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const saveUsername = useMutation({
    mutationFn: (value: string) =>
      MeService.updateUserMe({
        requestBody: { letterboxd_username: value || null },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["currentUser"], updated)
      queryClient.invalidateQueries({ queryKey: ["showtimes"] })
      queryClient.invalidateQueries({ queryKey: ["movies"] })
    },
    onError: () =>
      showErrorToast("Your Letterboxd username was not saved. Try again."),
  })

  const afterSync = () => {
    queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    queryClient.invalidateQueries({ queryKey: ["showtimes"] })
    queryClient.invalidateQueries({ queryKey: ["movies"] })
  }
  const syncWatchlist = useMutation({
    mutationFn: () => MeService.syncWatchlist(),
    onSettled: afterSync,
  })
  const syncWatched = useMutation({
    mutationFn: () => MeService.syncWatched(),
    onSettled: afterSync,
  })

  const trimmed = username.trim()
  const canSave =
    trimmed !== (user?.letterboxd_username ?? "") && !saveUsername.isPending
  const hasUsername = Boolean(user?.letterboxd_username)

  return (
    <SettingsSection
      id="letterboxd"
      title="Letterboxd"
      icon={meta.icon}
      description="Link your Letterboxd account to see what's on your watchlist and what you've already seen."
    >
      <div className="st-card">
        <form
          className="st-card__body"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) saveUsername.mutate(trimmed)
          }}
        >
          <SettingsField
            label="Letterboxd username"
            htmlFor={LETTERBOXD_USERNAME_INPUT_ID}
          >
            <div className="st-affix">
              <span className="st-affix__prefix">letterboxd.com/</span>
              <input
                id={LETTERBOXD_USERNAME_INPUT_ID}
                className="st-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={saveUsername.isPending}
              />
            </div>
          </SettingsField>
          {user?.letterboxd_account_not_found && user.letterboxd_username ? (
            <LetterboxdNotFoundWarning username={user.letterboxd_username} />
          ) : null}
          <div className="st-actions st-actions--end">
            <FriendButton
              primary
              busy={!canSave}
              onClick={() => saveUsername.mutate(trimmed)}
            >
              {saveUsername.isPending
                ? "Saving…"
                : trimmed || !hasUsername
                  ? "Save username"
                  : "Unlink"}
            </FriendButton>
          </div>
        </form>

        {hasUsername ? (
          <div className="st-card__body">
            <div className="st-stats">
              <div className="st-stat">
                <span className="st-stat__value">
                  {user?.watchlist_count ?? 0}
                </span>
                <span className="st-stat__label">Watchlisted</span>
              </div>
              <div className="st-stat">
                <span className="st-stat__value">
                  {user?.watched_count ?? 0}
                </span>
                <span className="st-stat__label">Watched</span>
              </div>
            </div>
            <SyncRow
              title="Watchlist"
              lastSynced={user?.watchlist_last_synced}
              failed={user?.watchlist_sync_failed ?? false}
              cooldownEndsAt={user?.watchlist_sync_cooldown_ends_at}
              syncing={syncWatchlist.isPending}
              onSync={() => syncWatchlist.mutate()}
              now={now}
            />
            <SyncRow
              title="Watched"
              lastSynced={user?.watched_last_synced}
              failed={user?.watched_sync_failed ?? false}
              cooldownEndsAt={user?.watched_sync_cooldown_ends_at}
              syncing={syncWatched.isPending}
              onSync={() => syncWatched.mutate()}
              now={now}
            />
            <SettingsRow
              title="Use my profile picture"
              description={
                avatarPreference.pictureUrl
                  ? "Show your Letterboxd profile picture to friends on MiKiNO."
                  : "Show your Letterboxd profile picture to friends on MiKiNO. We'll fetch it from Letterboxd as soon as you turn this on."
              }
            >
              <Switch
                checked={avatarPreference.enabled}
                onChange={avatarPreference.setEnabled}
                label="Use my Letterboxd profile picture"
              />
            </SettingsRow>
          </div>
        ) : null}
      </div>

      <LetterboxdLists
        onAdded={() => showSuccessToast("List added.")}
        onAddFailed={() =>
          showErrorToast(
            "Could not add that list. Check the URL points at a public Letterboxd list.",
          )
        }
      />
    </SettingsSection>
  )
}

const SyncRow = ({
  title,
  lastSynced,
  failed,
  cooldownEndsAt,
  syncing,
  onSync,
  now,
}: {
  title: string
  lastSynced: string | null | undefined
  failed: boolean
  cooldownEndsAt: string | null | undefined
  syncing: boolean
  onSync: () => void
  now: DateTime
}) => {
  const coolingDown = isCoolingDown(cooldownEndsAt, now)
  return (
    <div className="st-list-row">
      <div className="st-list-row__text">
        <span className="st-list-row__title">{title}</span>
        <span className="st-list-row__meta">
          {syncing ? "Syncing…" : formatSynced(lastSynced)}
        </span>
        {failed && !syncing ? (
          <span className="st-list-row__meta st-sync-failed">
            Last sync failed
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="st-icon-button"
        onClick={onSync}
        disabled={syncing || coolingDown}
        aria-label={`Refresh ${title.toLowerCase()}`}
        title={`Refresh ${title.toLowerCase()}`}
      >
        <MdSync className={syncing ? "st-spin" : undefined} aria-hidden />
      </button>
    </div>
  )
}

/** "synced 3 hours ago", or nothing if it never has been. */
const formatListSynced = (iso: string | null): string | null => {
  if (!iso) return null
  const dt = DateTime.fromISO(iso)
  return dt.isValid ? `synced ${dt.toRelative()}` : null
}

const LetterboxdLists = ({
  onAdded,
  onAddFailed,
}: {
  onAdded: () => void
  onAddFailed: () => void
}) => {
  const { data: lists } = useFetchLetterboxdLists()
  const { addList, syncList, removeList } = useLetterboxdListMutations()
  const [url, setUrl] = useState("")

  const handleAdd = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    addList.mutate(trimmed, {
      onSuccess: () => {
        setUrl("")
        onAdded()
      },
      onError: onAddFailed,
    })
  }

  const own = lists?.filter((list) => !list.is_curated) ?? []
  const curated = lists?.filter((list) => list.is_curated) ?? []

  return (
    <div className="st-card">
      <form
        className="st-card__body"
        onSubmit={(event) => {
          event.preventDefault()
          handleAdd()
        }}
      >
        <p className="st-card__subtitle">Your lists</p>
        <p className="st-help">
          Add a public Letterboxd list to filter the feed down to it, hide
          everything on it, or get an email when something from it is showing.
        </p>
        <div className="st-list-row">
          <input
            className="st-input"
            placeholder="https://letterboxd.com/…/list/…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-label="Letterboxd list URL"
            type="url"
          />
          <FriendButton
            primary
            icon={<MdAdd size={16} />}
            busy={!url.trim() || addList.isPending}
            onClick={handleAdd}
          >
            {addList.isPending ? "Adding…" : "Add"}
          </FriendButton>
        </div>

        {own.length ? (
          own.map((list) => {
            const synced = formatListSynced(list.last_synced)
            return (
              <div key={list.id} className="st-list-row">
                <div className="st-list-row__text">
                  <span className="st-list-row__title">
                    {list.title ?? list.list_slug}
                  </span>
                  <span className="st-list-row__meta">
                    {list.film_count} films{synced ? ` · ${synced}` : ""}
                  </span>
                </div>
                <FriendButton
                  busy={syncList.isPending && syncList.variables === list.id}
                  onClick={() => syncList.mutate(list.id)}
                >
                  Re-sync
                </FriendButton>
                <FriendButton
                  destructive
                  onClick={() => removeList.mutate(list.id)}
                >
                  Remove
                </FriendButton>
              </div>
            )
          })
        ) : (
          <p className="st-help">You haven't added any lists yet.</p>
        )}
      </form>

      {curated.length ? (
        <div className="st-card__body">
          <p className="st-card__subtitle">
            Curated lists — available to everyone
          </p>
          {curated.map((list) => (
            <div key={list.id} className="st-list-row">
              <div className="st-list-row__text">
                <span className="st-list-row__title">
                  {list.title ?? list.list_slug}
                </span>
                <span className="st-list-row__meta">
                  {list.film_count} films
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default LetterboxdSection
