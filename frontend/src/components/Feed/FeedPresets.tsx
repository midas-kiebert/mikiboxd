/**
 * Saved filter presets, above the feed.
 *
 * A preset is a named set of filters you can put back on in one click. The
 * model is entirely shared with the app — including the part that is easy to
 * get wrong, which is that a preset *controls* every dimension except the ones
 * it was saved as deliberately leaving alone. Applying one therefore clears
 * filters you set by hand, and that is the intended behaviour rather than a bug
 * to work around here.
 *
 * Reordering is left out. On a phone it is a drag on a row you can reach; here
 * the list is short, visible, and sorted the same way the app sorts it, so it
 * would be work spent on a problem the extra space already solves.
 */
import { useState } from "react"
import {
  Button,
  Flex,
  IconButton,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FiStar, FiTrash2 } from "react-icons/fi"
import { MeService } from "shared/client"
import useAuth from "shared/hooks/useAuth"
import {
  type DisplayPreset,
  buildSavedPresetCreate,
  displayPresetsQueryKey,
  presetKey,
} from "shared/filters/saved-presets"
import { useDisplayPresets } from "shared/filters/useDisplayPresets"

import { useIsSignedIn } from "@/auth/useSession"
import {
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
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

const FeedPresets = ({ params, onChange }: FeedPresetsProps) => {
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
      <Flex gap={2} align="center" wrap="wrap">
        {presets.map((preset) => (
          <Flex key={presetKey(preset)} align="center" gap={0}>
            <Button
              size="xs"
              variant={preset.isFavorite ? "solid" : "surface"}
              colorPalette={preset.isFavorite ? "green" : "gray"}
              onClick={() => apply(preset)}
            >
              {preset.name}
            </Button>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={
                preset.isFavorite
                  ? `Unfavourite ${preset.name}`
                  : `Favourite ${preset.name}`
              }
              onClick={() =>
                setFavorite({ preset, makeFavorite: !preset.isFavorite })
              }
            >
              <FiStar />
            </IconButton>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={`Delete ${preset.name}`}
              onClick={() => remove(preset)}
            >
              <FiTrash2 />
            </IconButton>
          </Flex>
        ))}

        <Button size="xs" variant="ghost" onClick={() => setIsSaveOpen(true)}>
          Save these filters
        </Button>
      </Flex>

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
                  <Text fontSize="sm">
                    Include the cinemas I have selected
                  </Text>
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
}

export default FeedPresets
