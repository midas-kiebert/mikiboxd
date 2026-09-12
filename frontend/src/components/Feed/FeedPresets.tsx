import { Box, Button, Flex, Input, Portal, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
/**
 * Saved filter presets, in the filter rail.
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
 *
 * A preset button is squared and never renders as selected, even when the
 * current filters match it exactly — see `RailActionButton`. That matters more
 * here than it did above the list, because the rail's other controls are all
 * fully-rounded state pills and a rounded preset would be indistinguishable
 * from one. The favourite is marked by a filled star, not by a fill on the
 * button.
 *
 * Reordering is left out. On a phone it is a drag on a row you can reach; here
 * the list is short, visible, and sorted the same way the app sorts it, so it
 * would be work spent on a problem the extra space already solves.
 */
import { memo, useState } from "react"
import { FaStar } from "react-icons/fa"
import { FiStar, FiTrash2 } from "react-icons/fi"
import { MeService } from "shared/client"
import {
  type DisplayPreset,
  buildSavedPresetCreate,
  displayPresetsQueryKey,
  presetKey,
} from "shared/filters/saved-presets"
import { useDisplayPresets } from "shared/filters/useDisplayPresets"
import useAuth from "shared/hooks/useAuth"

import { useIsSignedIn } from "@/auth/useSession"
import {
  RailActionButton,
  RailIconButton,
} from "@/components/Feed/FilterRailControls"
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
import useCustomToast from "@/hooks/useCustomToast"

type FeedPresetsProps = {
  params: FeedParams
  onChange: (patch: Partial<FeedParams>) => void
}

const FeedPresets = memo(function FeedPresets({
  params,
  onChange,
}: FeedPresetsProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast } = useCustomToast()

  const { presets, remove, setFavorite } = useDisplayPresets({
    enabled: isSignedIn,
  })

  const [isSaveOpen, setIsSaveOpen] = useState(false)
  const [name, setName] = useState("")
  const [includeCinemas, setIncludeCinemas] = useState(true)

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: () =>
      MeService.createSavedPreset({
        requestBody: buildSavedPresetCreate({
          name: name.trim(),
          isFavorite: false,
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
      showSuccessToast("Preset saved.")
      queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey })
    },
  })

  const apply = (preset: DisplayPreset) => {
    onChange(
      presetPatchForFeed(preset, params, Boolean(user?.letterboxd_username)),
    )
  }

  if (!isSignedIn) return null

  // Render/output using the state and derived values prepared above.
  return (
    <>
      {/* One preset per row rather than a wrapping strip: the rail is a column,
          and a name the user chose can be any length. */}
      <Stack gap={1}>
        {presets.map((preset) => (
          <Flex key={presetKey(preset)} align="center" gap={1}>
            <Box flex="1" minW={0}>
              <RailActionButton
                fullWidth
                title={`Apply ${preset.name}`}
                onClick={() => apply(preset)}
              >
                {preset.name}
              </RailActionButton>
            </Box>
            <RailIconButton
              label={
                preset.isFavorite
                  ? `Unfavourite ${preset.name}`
                  : `Favourite ${preset.name}`
              }
              onClick={() =>
                setFavorite({ preset, makeFavorite: !preset.isFavorite })
              }
            >
              {preset.isFavorite ? <FaStar /> : <FiStar />}
            </RailIconButton>
            <RailIconButton
              label={`Delete ${preset.name}`}
              onClick={() => remove(preset)}
            >
              <FiTrash2 />
            </RailIconButton>
          </Flex>
        ))}

        <RailActionButton onClick={() => setIsSaveOpen(true)}>
          Save these filters
        </RailActionButton>
      </Stack>

      <DialogRoot
        open={isSaveOpen}
        onOpenChange={(details) => setIsSaveOpen(details.open)}
      >
        <Portal>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save these filters</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Stack gap={3}>
                <Input
                  autoFocus
                  placeholder="Name this preset"
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
