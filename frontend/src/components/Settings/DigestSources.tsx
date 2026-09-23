/**
 * The advanced body of "Notify on new films" — the app's
 * `WatchlistDigestSourcesSection`.
 *
 * An account can have up to five digest sources, each one standing question
 * sent on its own schedule: how often (Eager or Weekly), which films (your
 * watchlist or a Letterboxd list) and where (all cinemas, a preset, or a hand-
 * picked set). Saved sources show as a one-line summary with an edit toggle, so
 * the list stays scannable; a new one is a local draft until "Save source",
 * and cancelling it never reaches the backend.
 *
 * What Eager and Weekly mean is written by the backend, so the app, the
 * website and the emails themselves describe the cadence the same way.
 */
import { Portal } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  MdAdd,
  MdCheck,
  MdDeleteOutline,
  MdEdit,
  MdInfoOutline,
} from "react-icons/md"
import type {
  CinemaPresetPublic,
  DigestFrequency,
  LetterboxdListPublic,
  WatchlistDigestSourceCreate,
  WatchlistDigestSourcePublic,
  WatchlistDigestSourceUpdate,
} from "shared"
import { MeService, UtilsService } from "shared/client"
import { sortCinemaIds } from "shared/filters/cinema-grouping"
import {
  findMyCinemasPreset,
  findNamedCinemaPresets,
  useCinemaPresets,
} from "shared/filters/cinema-presets"
import { useFetchCinemas } from "shared/hooks/useFetchCinemas"
import {
  useFetchLetterboxdLists,
  useLetterboxdListMutations,
} from "shared/hooks/useLetterboxdLists"

import { CinemaChecklist } from "@/components/Feed/CinemaChecklist"
import { FriendButton } from "@/components/Friends/friend-controls"
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"

import {
  ConfirmDialog,
  Segmented,
  type SegmentedOption,
  SettingsField,
} from "./settings-controls"

const sourcesQueryKey = ["me", "watchlist-digest-sources"] as const

const MAX_SOURCES = 5

const FREQUENCY_OPTIONS: readonly SegmentedOption<DigestFrequency>[] = [
  { value: "daily", label: "Eager" },
  { value: "weekly_or_urgent", label: "Weekly" },
]

type SourceFields = {
  frequency: DigestFrequency
  list_id: string | null
  cinema_preset_id: string | null
  custom_cinema_ids: number[] | null
}

const EMPTY_DRAFT: SourceFields = {
  frequency: "weekly_or_urgent",
  list_id: null,
  cinema_preset_id: null,
  custom_cinema_ids: null,
}

const summarizeSource = (
  source: SourceFields,
  lists: readonly LetterboxdListPublic[],
  presets: readonly CinemaPresetPublic[],
  letterboxdUsername: string | null,
): string => {
  const frequency = source.frequency === "daily" ? "Eager" : "Weekly"

  let list: string
  if (source.list_id) {
    const match = lists.find((candidate) => candidate.id === source.list_id)
    list = match ? (match.title ?? match.list_slug) : "a list"
  } else {
    list = letterboxdUsername ? "My watchlist" : "No watchlist connected"
  }

  let cinemas = "All cinemas"
  if (source.cinema_preset_id) {
    const preset = presets.find(
      (candidate) => candidate.id === source.cinema_preset_id,
    )
    cinemas = preset ? preset.name : "a cinema preset"
  } else if (source.custom_cinema_ids?.length) {
    const count = source.custom_cinema_ids.length
    cinemas = `${count} cinema${count === 1 ? "" : "s"}`
  }

  return `${frequency} · ${list} · ${cinemas}`
}

const DigestSources = ({
  letterboxdUsername,
}: { letterboxdUsername: string | null }) => {
  // Read flow: data first, then local editing state and writes, then JSX.
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const { data: sources = [] } = useQuery({
    queryKey: sourcesQueryKey,
    queryFn: () => MeService.getWatchlistDigestSources(),
  })
  const { data: lists = [] } = useFetchLetterboxdLists()
  const { data: presets = [] } = useCinemaPresets({ enabled: true })
  const { data: frequencyInfo } = useQuery({
    queryKey: ["watchlist-digest-frequency-info"],
    queryFn: () => UtilsService.getWatchlistDigestFrequencyInfo(),
    staleTime: Number.POSITIVE_INFINITY,
  })

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SourceFields | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isFrequencyInfoOpen, setIsFrequencyInfoOpen] = useState(false)
  // "draft" is the unsaved source; anything else is a saved source's id.
  const [pickerTarget, setPickerTarget] = useState<string | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: sourcesQueryKey })
  const failed = () =>
    showErrorToast("Could not save that digest source. Try again.")

  const createSource = useMutation({
    mutationFn: (payload: WatchlistDigestSourceCreate) =>
      MeService.createWatchlistDigestSource({ requestBody: payload }),
    onSuccess: () => {
      setDraft(null)
      refresh()
    },
    onError: failed,
  })
  const updateSource = useMutation({
    mutationFn: (variables: {
      sourceId: string
      payload: WatchlistDigestSourceUpdate
    }) =>
      MeService.updateWatchlistDigestSource({
        sourceId: variables.sourceId,
        requestBody: variables.payload,
      }),
    onSuccess: refresh,
    onError: failed,
  })
  const deleteSource = useMutation({
    mutationFn: (sourceId: string) =>
      MeService.deleteWatchlistDigestSource({ sourceId }),
    onSuccess: refresh,
    onError: () =>
      showErrorToast("Could not remove that digest source. Try again."),
  })

  const editorProps = {
    lists,
    presets,
    letterboxdUsername,
    onShowFrequencyInfo: () => setIsFrequencyInfoOpen(true),
  }

  const pickerInitialIds =
    pickerTarget === "draft"
      ? (draft?.custom_cinema_ids ?? [])
      : (sources.find((source) => source.id === pickerTarget)
          ?.custom_cinema_ids ?? [])

  return (
    <div className="st-sources">
      <p className="st-help">
        You can add several sources for where MiKiNO should look for new films.
        Each one sets how often you hear about it, which films it follows, and
        the cinemas they have to be playing in.
      </p>

      {sources.map((source: WatchlistDigestSourcePublic) => {
        const isExpanded = expandedId === source.id
        return (
          <div key={source.id} className="st-source">
            <div className="st-source__head">
              <span className="st-source__summary">
                {summarizeSource(source, lists, presets, letterboxdUsername)}
              </span>
              <button
                type="button"
                className="st-icon-button st-icon-button--quiet"
                onClick={() => setExpandedId(isExpanded ? null : source.id)}
                aria-label={
                  isExpanded ? "Done editing this source" : "Edit this source"
                }
                aria-expanded={isExpanded}
              >
                {isExpanded ? <MdCheck aria-hidden /> : <MdEdit aria-hidden />}
              </button>
              <button
                type="button"
                className="st-icon-button st-icon-button--quiet"
                onClick={() => setPendingDeleteId(source.id)}
                aria-label="Remove this source"
              >
                <MdDeleteOutline aria-hidden />
              </button>
            </div>
            {isExpanded ? (
              <SourceEditor
                {...editorProps}
                fields={source}
                disabled={updateSource.isPending}
                onChange={(payload) =>
                  updateSource.mutate({ sourceId: source.id, payload })
                }
                onOpenCinemaPicker={() => setPickerTarget(source.id)}
              />
            ) : null}
          </div>
        )
      })}

      {draft ? (
        <div className="st-source st-source--draft">
          <span className="st-source__summary">New source</span>
          <SourceEditor
            {...editorProps}
            fields={draft}
            disabled={createSource.isPending}
            onChange={(payload) =>
              setDraft((current) =>
                current ? { ...current, ...payload } : current,
              )
            }
            onOpenCinemaPicker={() => setPickerTarget("draft")}
          />
          <div className="st-actions st-actions--end">
            <FriendButton
              onClick={() => setDraft(null)}
              busy={createSource.isPending}
            >
              Cancel
            </FriendButton>
            <FriendButton
              primary
              busy={createSource.isPending}
              onClick={() => createSource.mutate(draft)}
            >
              {createSource.isPending ? "Saving…" : "Save source"}
            </FriendButton>
          </div>
        </div>
      ) : sources.length < MAX_SOURCES ? (
        <button
          type="button"
          className="st-add-source"
          onClick={() => setDraft(EMPTY_DRAFT)}
        >
          <MdAdd aria-hidden />
          <span className="st-link-row__label">Add a source</span>
        </button>
      ) : null}

      <ConfirmDialog
        open={isFrequencyInfoOpen}
        title="Eager vs Weekly"
        message={
          frequencyInfo
            ? `${frequencyInfo.daily.label}: ${frequencyInfo.daily.description}\n\n${frequencyInfo.weekly_or_urgent.label}: ${frequencyInfo.weekly_or_urgent.description}`
            : undefined
        }
        cancelLabel={null}
        confirmLabel="Got it"
        onConfirm={() => {}}
        onClose={() => setIsFrequencyInfoOpen(false)}
      />
      <ConfirmDialog
        open={pendingDeleteId !== null}
        tone="destructive"
        title="Remove this source?"
        message="It will stop sending its own emails. This can't be undone."
        confirmLabel="Remove"
        onConfirm={() => {
          if (!pendingDeleteId) return
          deleteSource.mutate(pendingDeleteId)
          if (expandedId === pendingDeleteId) setExpandedId(null)
        }}
        onClose={() => setPendingDeleteId(null)}
      />
      <CustomCinemaDialog
        open={pickerTarget !== null}
        initialIds={pickerInitialIds}
        onClose={() => setPickerTarget(null)}
        onSave={(cinemaIds) => {
          const payload = {
            cinema_preset_id: null,
            custom_cinema_ids: cinemaIds,
          }
          if (pickerTarget === "draft") {
            setDraft((current) =>
              current ? { ...current, ...payload } : current,
            )
          } else if (pickerTarget) {
            updateSource.mutate({ sourceId: pickerTarget, payload })
          }
          setPickerTarget(null)
        }}
      />
    </div>
  )
}

/**
 * Frequency, list and cinemas for one source. Every change goes straight back
 * to the caller, which decides whether it edits the draft or saves the source.
 */
const SourceEditor = ({
  fields,
  lists,
  presets,
  letterboxdUsername,
  disabled,
  onChange,
  onOpenCinemaPicker,
  onShowFrequencyInfo,
}: {
  fields: SourceFields
  lists: readonly LetterboxdListPublic[]
  presets: readonly CinemaPresetPublic[]
  letterboxdUsername: string | null
  disabled: boolean
  onChange: (payload: Partial<SourceFields>) => void
  onOpenCinemaPicker: () => void
  onShowFrequencyInfo: () => void
}) => {
  const { addList } = useLetterboxdListMutations()
  const [listUrl, setListUrl] = useState("")
  const myCinemas = findMyCinemasPreset(presets)
  const namedPresets = findNamedCinemaPresets(presets)
  const customCount = fields.custom_cinema_ids?.length ?? 0

  const handleAddList = () => {
    const url = listUrl.trim()
    if (!url) return
    addList.mutate(url, { onSuccess: () => setListUrl("") })
  }

  const chip = (
    label: string,
    isOn: boolean,
    onClick: () => void,
    key = label,
  ) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={isOn}
      className="st-chip"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <>
      <SettingsField
        label="Frequency"
        aside={
          <button
            type="button"
            className="st-icon-button st-icon-button--quiet"
            onClick={onShowFrequencyInfo}
            aria-label="What do Eager and Weekly mean?"
          >
            <MdInfoOutline aria-hidden />
          </button>
        }
      >
        <div>
          <Segmented
            options={FREQUENCY_OPTIONS}
            value={fields.frequency}
            onChange={(frequency) => onChange({ frequency })}
            label="Frequency"
            disabled={disabled}
          />
        </div>
      </SettingsField>

      <SettingsField label="List">
        <div className="st-chips" role="radiogroup" aria-label="List">
          {letterboxdUsername
            ? chip("My watchlist", fields.list_id === null, () =>
                onChange({ list_id: null }),
              )
            : null}
          {lists.map((list) =>
            chip(
              `${list.title ?? list.list_slug}${list.is_curated ? " (curated)" : ""}`,
              fields.list_id === list.id,
              () => onChange({ list_id: list.id }),
              list.id,
            ),
          )}
        </div>
        {!letterboxdUsername && !fields.list_id ? (
          <p className="st-help">
            No watchlist connected — link Letterboxd above, or pick a list.
          </p>
        ) : null}
        <form
          className="st-list-row"
          onSubmit={(event) => {
            event.preventDefault()
            handleAddList()
          }}
        >
          <input
            className="st-input"
            type="url"
            placeholder="Paste a Letterboxd list URL"
            value={listUrl}
            onChange={(event) => setListUrl(event.target.value)}
            aria-label="Letterboxd list URL"
          />
          <FriendButton
            primary
            icon={<MdAdd size={16} />}
            busy={!listUrl.trim() || addList.isPending}
            onClick={handleAddList}
          >
            {addList.isPending ? "Adding…" : "Add"}
          </FriendButton>
        </form>
        {addList.isError ? (
          <p className="st-error">
            Couldn't add that list. Check the URL and try again.
          </p>
        ) : null}
      </SettingsField>

      <SettingsField label="Cinemas">
        <div className="st-chips" role="radiogroup" aria-label="Cinemas">
          {chip(
            "All cinemas",
            !fields.cinema_preset_id && !fields.custom_cinema_ids,
            () => onChange({ cinema_preset_id: null, custom_cinema_ids: null }),
          )}
          {myCinemas
            ? chip(
                `Default (${myCinemas.name})`,
                fields.cinema_preset_id === myCinemas.id,
                () =>
                  onChange({
                    cinema_preset_id: myCinemas.id,
                    custom_cinema_ids: null,
                  }),
                myCinemas.id,
              )
            : null}
          {namedPresets.map((preset) =>
            chip(
              preset.name,
              fields.cinema_preset_id === preset.id,
              () =>
                onChange({
                  cinema_preset_id: preset.id,
                  custom_cinema_ids: null,
                }),
              preset.id,
            ),
          )}
          {chip(
            fields.custom_cinema_ids
              ? `Custom (${customCount})`
              : "Custom cinemas…",
            Boolean(fields.custom_cinema_ids),
            onOpenCinemaPicker,
            "custom",
          )}
        </div>
      </SettingsField>
    </>
  )
}

/**
 * A one-off multi-select of cinemas for a source — the app's
 * `CustomCinemaPickerModal`. Not the feed's cinema sheet, which is bound to
 * the session's selection and presets: this only hands back a list of ids,
 * and nothing here is saved as a preset.
 */
const CustomCinemaDialog = ({
  open,
  initialIds,
  onClose,
  onSave,
}: {
  open: boolean
  initialIds: readonly number[]
  onClose: () => void
  onSave: (cinemaIds: number[]) => void
}) => {
  const { data: cinemas = [] } = useFetchCinemas()
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    () => new Set(initialIds),
  )

  // Starts from the source's saved selection on every open, never from
  // whatever was left ticked by a cancelled one.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSelected(new Set(initialIds))
  }

  const update = (change: (next: Set<number>) => void) =>
    setSelected((current) => {
      const next = new Set(current)
      change(next)
      return next
    })

  return (
    <DialogRoot
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose()
      }}
      size="lg"
      placement="center"
      scrollBehavior="inside"
    >
      <Portal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick cinemas</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <CinemaChecklist
              cinemas={cinemas}
              selectedIds={selected}
              onToggle={(id) =>
                update((next) => {
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                })
              }
              onOnly={(id) => setSelected(new Set([id]))}
              onSelect={(ids) =>
                update((next) => {
                  for (const id of ids) next.add(id)
                })
              }
              onDeselect={(ids) =>
                update((next) => {
                  for (const id of ids) next.delete(id)
                })
              }
            />
          </DialogBody>
          <DialogFooter>
            <FriendButton onClick={onClose}>Cancel</FriendButton>
            <FriendButton
              primary
              busy={selected.size === 0}
              onClick={() => onSave(sortCinemaIds(selected))}
            >
              {selected.size === 0
                ? "Pick at least one"
                : `Use ${selected.size} cinema${selected.size === 1 ? "" : "s"}`}
            </FriendButton>
          </DialogFooter>
        </DialogContent>
      </Portal>
    </DialogRoot>
  )
}

export default DigestSources
