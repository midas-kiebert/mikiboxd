/**
 * Named cinema selections, at the top of the Cinemas section.
 *
 * A separate layer from saved filter presets: this one only ever sets which
 * cinemas are picked, which is the selection people change most often and least
 * want to rebuild by hand.
 *
 * Two rows are special and the shared helpers are what tell them apart —
 * never the name, because both can be renamed. The favourite is "my cinemas",
 * the one every account has and starts up with. The default is the synthetic
 * "All cinemas" row, which has no database row behind it and so cannot be
 * renamed or deleted.
 */
import { useState } from "react"
import { Button, Flex, IconButton, Input, Portal, Stack, Text } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FiEdit2, FiStar, FiTrash2 } from "react-icons/fi"
import { MeService } from "shared/client"
import {
  findNamedCinemaPresets,
  invalidateCinemaPresets,
  nextCinemaPresetName,
  useCinemaPresets,
} from "shared/filters/cinema-presets"

import { useIsSignedIn } from "@/auth/useSession"
import {
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FeedParams } from "@/features/showtimes/feed-params"

type CinemaPresetsProps = {
  params: FeedParams
  onChange: (patch: Partial<FeedParams>) => void
}

const CinemaPresets = ({ params, onChange }: CinemaPresetsProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const queryClient = useQueryClient()
  const { data: presets = [] } = useCinemaPresets({ enabled: isSignedIn })

  const [isSaveOpen, setIsSaveOpen] = useState(false)
  const [name, setName] = useState("")
  const [renaming, setRenaming] = useState<string | null>(null)

  const refresh = () => invalidateCinemaPresets(queryClient)

  const { mutate: create, isPending: isCreating } = useMutation({
    mutationFn: () =>
      MeService.createCinemaPreset({
        requestBody: { name: name.trim(), cinema_ids: [...params.cinemas] },
      }),
    onSuccess: () => {
      setIsSaveOpen(false)
      refresh()
    },
  })

  const { mutate: rename } = useMutation({
    mutationFn: (variables: { presetId: string; name: string }) =>
      MeService.renameCinemaPreset({
        presetId: variables.presetId,
        requestBody: { name: variables.name },
      }),
    onSuccess: () => {
      setRenaming(null)
      refresh()
    },
  })

  /**
   * Which preset is "my cinemas" — the one applied at startup. Exactly one is
   * the favourite, so this is a move rather than a toggle.
   */
  const { mutate: makeDefault } = useMutation({
    mutationFn: (presetId: string) =>
      MeService.setFavoriteCinemaPreset({ presetId }),
    onSuccess: refresh,
  })

  const { mutate: remove } = useMutation({
    mutationFn: (presetId: string) =>
      MeService.deleteCinemaPreset({ presetId }),
    onSuccess: refresh,
  })

  if (!isSignedIn) return null

  const named = findNamedCinemaPresets(presets)

  /** A preset is "on" when the feed is showing exactly its cinemas. */
  const isActive = (cinemaIds: number[]) =>
    cinemaIds.length === params.cinemas.length &&
    cinemaIds.every((id) => params.cinemas.includes(id))

  const openSave = () => {
    // Prefilled, so saving never *requires* typing — an empty box that blocks
    // the button is what makes this read as a mistake rather than a choice.
    setName(nextCinemaPresetName(presets))
    setIsSaveOpen(true)
  }

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <Stack gap={1} mb={2}>
        {presets.map((preset) => (
          <Flex key={preset.id} align="center" gap={1}>
            <Button
              size="2xs"
              flex="1"
              justifyContent="flex-start"
              variant={isActive(preset.cinema_ids) ? "solid" : "surface"}
              colorPalette={isActive(preset.cinema_ids) ? "green" : "gray"}
              onClick={() => onChange({ cinemas: [...preset.cinema_ids] })}
            >
              {preset.name}
            </Button>

            {/* The synthetic "All cinemas" row has nothing behind it to edit. */}
            {preset.is_default ? null : (
              <>
                <IconButton
                  size="2xs"
                  variant="ghost"
                  aria-label={`Rename ${preset.name}`}
                  onClick={() => {
                    setRenaming(preset.id)
                    setName(preset.name)
                  }}
                >
                  <FiEdit2 />
                </IconButton>
                {/* The favourite is "my cinemas" — every account has exactly
                    one, so it can be moved but not deleted. */}
                {preset.is_favorite ? null : (
                  <>
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      aria-label={`Make ${preset.name} my cinemas`}
                      title="Use these at startup"
                      onClick={() => makeDefault(preset.id)}
                    >
                      <FiStar />
                    </IconButton>
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      aria-label={`Delete ${preset.name}`}
                      onClick={() => remove(preset.id)}
                    >
                      <FiTrash2 />
                    </IconButton>
                  </>
                )}
              </>
            )}
          </Flex>
        ))}

        {params.cinemas.length ? (
          <Button
            size="2xs"
            variant="ghost"
            alignSelf="flex-start"
            onClick={openSave}
          >
            Save this selection
          </Button>
        ) : null}
      </Stack>

      <DialogRoot
        open={isSaveOpen || renaming !== null}
        onOpenChange={(details) => {
          if (!details.open) {
            setIsSaveOpen(false)
            setRenaming(null)
          }
        }}
      >
        <Portal>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {renaming ? "Rename this preset" : "Save these cinemas"}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Stack gap={3}>
                <Input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label="Preset name"
                />
                {renaming ? null : (
                  <Text fontSize="sm" color="fg.muted">
                    {params.cinemas.length} cinemas selected.
                  </Text>
                )}
                <Flex justify="flex-end" gap={2}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsSaveOpen(false)
                      setRenaming(null)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    loading={isCreating}
                    disabled={name.trim() === ""}
                    onClick={() =>
                      renaming
                        ? rename({ presetId: renaming, name: name.trim() })
                        : create()
                    }
                  >
                    {renaming ? "Rename" : "Save"}
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

export default CinemaPresets
