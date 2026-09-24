import {
  Box,
  Button,
  Flex,
  Input,
  Portal,
  Stack,
  Text,
  chakra,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
/**
 * Saved filter presets, in the filter rail — the "Quick filters" part.
 *
 * A carbon copy of the filter lab's `QuickFilters` (`Feed/lab/FilterRail.tsx`,
 * deleted 2026-09-19): the heading and "Save current filters" share one row,
 * disabled until a filter is actually on; below it, either the empty note or
 * a wrap of squared chips, apply-only, never a sideways scroll. Nothing here
 * is new — the lab never drew a favourite star or a delete icon on a chip, so
 * this doesn't either.
 *
 * A preset is a named set of filters you can put back on in one click. The
 * model is entirely shared with the app — including the part that is easy to
 * get wrong, which is that a preset *controls* every dimension except the ones
 * it was saved as deliberately leaving alone. Applying one therefore clears
 * filters you set by hand, and that is the intended behaviour rather than a bug
 * to work around here.
 *
 * Lives in the filter rail rather than above the list, which is where the app
 * keeps it too: a preset is a way of setting the filters, so it belongs with
 * them and not in the bar that searches them.
 */
import { memo, useMemo, useRef, useState } from "react"
import { MdBookmarkAdd } from "react-icons/md"
import { MeService } from "shared/client"
import {
  type DisplayPreset,
  type PresetApplyContext,
  buildSavedPresetCreate,
  displayPresetsQueryKey,
  presetChangesNothing,
  presetKey,
} from "shared/filters/saved-presets"
import { useDisplayPresets } from "shared/filters/useDisplayPresets"
import useAuth from "shared/hooks/useAuth"

import { useIsSignedIn } from "@/auth/useSession"
import { RailPartLabel } from "@/components/Feed/FilterRailControls"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FeedParams } from "@/features/showtimes/feed-params"
import {
  feedParamsToPresetState,
  presetPatchForFeed,
} from "@/features/showtimes/feed-presets"
import { usePreferredCinemaIds } from "@/features/showtimes/guest-preferred-cinemas"
import useCustomToast from "@/hooks/useCustomToast"

import "./preset-chip.css"

const Pressable = chakra("button")

/**
 * Tap to settled, end to end — the CSS translation of `PresetButton`'s
 * `PRESS_MS` (`preset-chip.css`'s `mk-preset-chip-flash` keyframes). A press
 * within this window is not re-entered, and the chip claims "satisfied" for
 * its length regardless of what `presetChangesNothing` says yet, since the
 * dimensions a preset writes can land a frame or two after the click.
 */
const PRESS_MS = 320

/**
 * Preset chips are actions, not selections: a chip that would change nothing
 * dims and stops responding, the same rule `PresetButton` uses on mobile
 * (`isSatisfied`).
 */
function PresetChip({
  preset,
  isSatisfied,
  onApply,
}: {
  preset: DisplayPreset
  isSatisfied: boolean
  onApply: (preset: DisplayPreset) => void
}) {
  const [applying, setApplying] = useState(false)
  const [flashNonce, setFlashNonce] = useState(0)
  const pressEndsAtRef = useRef(0)

  const satisfied = isSatisfied || applying

  const handleClick = () => {
    if (satisfied) return
    if (pressEndsAtRef.current > Date.now()) return
    pressEndsAtRef.current = Date.now() + PRESS_MS
    setApplying(true)
    setFlashNonce((n) => n + 1)
    setTimeout(() => setApplying(false), PRESS_MS)
    onApply(preset)
  }

  return (
    <button
      type="button"
      className="mk-preset-chip"
      data-satisfied={satisfied}
      data-applying={applying}
      disabled={satisfied}
      onClick={handleClick}
      title={satisfied ? "Already applied" : undefined}
    >
      {flashNonce > 0 && (
        <span key={flashNonce} className="mk-preset-chip__flash" />
      )}
      <span className="mk-preset-chip__label">{preset.name}</span>
    </button>
  )
}

type FeedPresetsProps = {
  params: FeedParams
  onChange: (patch: Partial<FeedParams>) => void
  /** Nothing to save until some filter is on. */
  activeFilterCount: number
}

const FeedPresets = memo(function FeedPresets({
  params,
  onChange,
  activeFilterCount,
}: FeedPresetsProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast } = useCustomToast()

  const { presets } = useDisplayPresets({ enabled: isSignedIn })
  const { data: preferredCinemaIds } = usePreferredCinemaIds()

  // What each chip compares itself against, to say whether it would still
  // change anything — the web mirror of `SavedPresetChips`' `applyContext`.
  // Empty `params.cinemas` means "whatever the account's usual cinemas are"
  // (see `FeedParams.cinemas`), so that is what a preset with no cinemas of
  // its own is compared against too.
  const applyContext = useMemo<PresetApplyContext>(
    () => ({
      currentFilters: feedParamsToPresetState(params),
      currentCinemaIds: params.cinemas.length
        ? params.cinemas
        : (preferredCinemaIds ?? []),
      hasLetterboxdUsername: Boolean(user?.letterboxd_username?.trim()),
    }),
    [params, preferredCinemaIds, user?.letterboxd_username],
  )

  const [isSaveOpen, setIsSaveOpen] = useState(false)
  const [name, setName] = useState("")
  const [includeCinemas, setIncludeCinemas] = useState(true)

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: () =>
      MeService.createSavedPreset({
        requestBody: buildSavedPresetCreate({
          name: name.trim(),
          // Everything the feed can express is controlled by the preset. The
          // app's save prompt lets you opt dimensions out one by one; that is a
          // refinement, and leaving it out means a preset here simply restores
          // exactly what you saved.
          untouchedFields: [],
          includeCinemas,
          currentFilters: feedParamsToPresetState(params),
          cinemaIds: [...params.cinemas],
        }),
      }),
    onSuccess: () => {
      setIsSaveOpen(false)
      setName("")
      showSuccessToast("Quick filter saved.")
      queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey })
    },
  })

  const apply = (preset: DisplayPreset) => {
    onChange(
      presetPatchForFeed(preset, params, Boolean(user?.letterboxd_username)),
    )
  }

  if (!isSignedIn) return null

  const canSave = activeFilterCount > 0

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <Flex align="center" justify="space-between" gap="8px" mb="7px">
        <RailPartLabel>Quick filters</RailPartLabel>
        <Pressable
          type="button"
          onClick={() => setIsSaveOpen(true)}
          disabled={!canSave}
          title={
            canSave
              ? "Save the filters you have on now, to put them back in one click"
              : "Turn on a filter first — there is nothing to save yet"
          }
          display="inline-flex"
          alignItems="center"
          gap="4px"
          px="6px"
          py="2px"
          borderRadius="6px"
          bg="transparent"
          color="app.tint"
          fontSize="12px"
          fontWeight="700"
          cursor="pointer"
          _hover={{ bg: "bg.subtle" }}
          _disabled={{
            color: "fg.subtle",
            cursor: "default",
            bg: "transparent",
          }}
        >
          <MdBookmarkAdd size={15} />
          <Box as="span" position="relative" top="1px">
            Save current filters
          </Box>
        </Pressable>
      </Flex>

      {presets.length === 0 ? (
        <Text fontSize="12px" color="fg.muted">
          None saved yet. Set some filters and save them to use again in one
          click.
        </Text>
      ) : (
        <Flex wrap="wrap" gap="6px">
          {presets.map((preset) => (
            <PresetChip
              key={presetKey(preset)}
              preset={preset}
              isSatisfied={presetChangesNothing(preset, applyContext)}
              onApply={apply}
            />
          ))}
        </Flex>
      )}

      <DialogRoot
        open={isSaveOpen}
        onOpenChange={(details) => setIsSaveOpen(details.open)}
      >
        <Portal>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save current filters</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Stack gap={3}>
                <Input
                  autoFocus
                  placeholder="Name this quick filter"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Checkbox
                  checked={includeCinemas}
                  onCheckedChange={(details) =>
                    setIncludeCinemas(!!details.checked)
                  }
                >
                  <Text fontSize="sm">Include the cinemas I have selected</Text>
                </Checkbox>
                <Flex justify="flex-end" gap={2}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsSaveOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    loading={isSaving}
                    disabled={name.trim() === ""}
                    onClick={() => save()}
                  >
                    Save
                  </Button>
                </Flex>
              </Stack>
            </DialogBody>
          </DialogContent>
        </Portal>
      </DialogRoot>
    </>
  )
})

export default FeedPresets
