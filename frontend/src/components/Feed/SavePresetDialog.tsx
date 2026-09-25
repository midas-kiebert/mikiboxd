/**
 * "Save quick filter": the web counterpart of the app's `SavePresetDialog`
 * (`mobile/components/filters/SavePresetDialog.tsx`), control for control —
 * the line saying what a quick filter does, the name field, the folded
 * "Partial filters" box with one checkable pill per filter, and Cancel and
 * Save side by side at equal width.
 *
 * Each pill is a filter the quick filter controls; unchecking one leaves that
 * filter as it is when the quick filter is applied later. The rows come from
 * the shared `summarizeCurrentSelections`, so both clients list the same ones.
 */
import { Box, Flex, Input, Text, chakra } from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdExpandLess,
  MdExpandMore,
} from "react-icons/md"
import { MeService } from "shared/client"
import {
  type PresetDimension,
  type PresetListSummary,
  buildSavedPresetCreate,
  displayPresetsQueryKey,
  summarizeCurrentSelections,
} from "shared/filters/saved-presets"
import { useFetchLetterboxdLists } from "shared/hooks/useLetterboxdLists"

import {
  DialogBody,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FeedParams } from "@/features/showtimes/feed-params"
import { feedParamsToPresetState } from "@/features/showtimes/feed-presets"
import useCustomToast from "@/hooks/useCustomToast"

const Pressable = chakra("button")

type SavePresetDialogProps = {
  open: boolean
  onClose: () => void
  params: FeedParams
  canUseWatchlistFilter: boolean
}

const cinemaLabelOf = (params: FeedParams) =>
  params.allCinemas
    ? "All cinemas"
    : params.cinemas.length
      ? `${params.cinemas.length} ${params.cinemas.length === 1 ? "cinema" : "cinemas"}`
      : "Your cinemas"

const SavePresetDialog = ({
  open,
  onClose,
  params,
  canUseWatchlistFilter,
}: SavePresetDialogProps) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const { data: letterboxdLists = [] } = useFetchLetterboxdLists(
    open && canUseWatchlistFilter,
  )
  const lists = useMemo<PresetListSummary[]>(
    () =>
      letterboxdLists.map((list) => ({
        id: list.id,
        title: list.title ?? list.list_slug,
      })),
    [letterboxdLists],
  )
  const currentFilters = useMemo(() => feedParamsToPresetState(params), [params])
  const summaries = useMemo(
    () =>
      summarizeCurrentSelections({
        currentFilters,
        cinemaLabel: cinemaLabelOf(params),
        cinemaActive: true,
        canUseWatchlistFilter,
        showRuntime: true,
        showGroupBy: true,
        lists,
      }),
    [currentFilters, params, canUseWatchlistFilter, lists],
  )

  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<Set<PresetDimension>>(new Set())
  const [partialOpen, setPartialOpen] = useState(false)

  // A fresh start each time it opens: every filter checked, as on the app.
  useEffect(() => {
    if (!open) return
    setName("")
    setError(null)
    setPartialOpen(false)
    setExcluded(new Set())
  }, [open])

  const isIncluded = (dimension: PresetDimension) => !excluded.has(dimension)
  const includedCount = summaries.filter((row) =>
    isIncluded(row.dimension),
  ).length

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      MeService.createSavedPreset({
        requestBody: buildSavedPresetCreate({
          name: name.trim(),
          // Unchecked filters are left as they are on apply; cinemas are
          // opt-in through `includeCinemas` instead.
          untouchedFields: summaries
            .map((row) => row.dimension)
            .filter(
              (dimension) => dimension !== "cinemas" && !isIncluded(dimension),
            ),
          includeCinemas: isIncluded("cinemas"),
          currentFilters,
          cinemaIds: [...params.cinemas],
        }),
      }),
    onSuccess: () => {
      showSuccessToast("Quick filter saved.")
      queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey })
      onClose()
    },
    onError: () => setError("Could not save quick filter. Please try again."),
  })

  const toggle = (dimension: PresetDimension) => {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(dimension)) next.delete(dimension)
      else next.add(dimension)
      return next
    })
    if (error) setError(null)
  }

  const canSave = name.trim().length > 0 && includedCount > 0 && !isPending

  const handleSave = () => {
    if (!name.trim()) {
      setError("Enter a name.")
      return
    }
    if (includedCount === 0) {
      setError("Include at least one filter.")
      return
    }
    save()
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(details) => {
        if (!details.open && !isPending) onClose()
      }}
      placement="center"
    >
      <DialogContent
        maxW="420px"
        borderRadius="14px"
        borderWidth="1px"
        borderColor="border"
        bg="bg.panel"
        boxShadow="0 18px 50px rgba(0, 0, 0, 0.28)"
      >
        <DialogBody p="18px" display="flex" flexDirection="column" gap="12px">
          <Box>
            <DialogTitle fontSize="16px" fontWeight="800" color="fg" mb="4px">
              Save quick filter
            </DialogTitle>
            <Text fontSize="12px" color="fg.muted" lineHeight="1.45">
              Saves all your current filters. Applying it later sets every
              filter to match this quick filter.
            </Text>
          </Box>

          <Input
            autoFocus
            placeholder="Quick filter name"
            aria-label="Quick filter name"
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave()
            }}
            h="38px"
            px="12px"
            borderRadius="10px"
            borderWidth="1px"
            borderColor="app.divider"
            bg="app.cardBackground"
            color="fg"
            fontSize="14px"
            fontWeight="500"
            _focusVisible={{ borderColor: "app.tint", outline: "none" }}
          />

          <Box
            borderWidth="1px"
            borderColor="app.divider"
            borderRadius="10px"
            bg="app.cardBackground"
            px="10px"
            py="8px"
          >
            <Pressable
              type="button"
              onClick={() => setPartialOpen((value) => !value)}
              aria-expanded={partialOpen}
              display="flex"
              alignItems="center"
              gap="8px"
              w="100%"
              p={0}
              bg="transparent"
              textAlign="left"
              cursor="pointer"
            >
              <Box flex="1" minW={0}>
                <Text fontSize="13px" fontWeight="600" color="fg">
                  Partial filters
                </Text>
                <Text fontSize="11px" color="fg.muted" lineHeight="1.4">
                  Choose which filters this quick filter controls.
                </Text>
              </Box>
              <Box color="fg.muted" display="flex">
                {partialOpen ? (
                  <MdExpandLess size={22} />
                ) : (
                  <MdExpandMore size={22} />
                )}
              </Box>
            </Pressable>

            {partialOpen ? (
              <>
                <Text
                  fontSize="11px"
                  color="fg.muted"
                  lineHeight="1.45"
                  mt="10px"
                >
                  By default the quick filter saves every filter. Uncheck a
                  filter to leave it untouched. When you apply it later, only
                  the checked filters change and the rest stay as they are.
                </Text>
                <Flex wrap="wrap" gap="6px" mt="10px">
                  {summaries.map((row) => {
                    const isChecked = isIncluded(row.dimension)
                    return (
                      <Pressable
                        key={row.dimension}
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        onClick={() => toggle(row.dimension)}
                        display="flex"
                        alignItems="center"
                        gap="5px"
                        maxW="100%"
                        px="9px"
                        py="5px"
                        borderRadius="10px"
                        borderWidth="1px"
                        borderColor={isChecked ? "app.tint" : "app.divider"}
                        bg="app.cardBackground"
                        textAlign="left"
                        cursor="pointer"
                        transition="border-color 120ms ease"
                      >
                        <Box
                          display="flex"
                          flexShrink={0}
                          color={isChecked ? "app.tint" : "fg.muted"}
                        >
                          {isChecked ? (
                            <MdCheckBox size={16} />
                          ) : (
                            <MdCheckBoxOutlineBlank size={16} />
                          )}
                        </Box>
                        <Box minW={0}>
                          <Text
                            fontSize="12px"
                            fontWeight="600"
                            lineHeight="15px"
                            color={isChecked ? "fg" : "fg.muted"}
                          >
                            {row.title}
                          </Text>
                          <Text
                            fontSize="10px"
                            lineHeight="13px"
                            color="fg.muted"
                            truncate
                          >
                            {row.valueLabel}
                          </Text>
                        </Box>
                      </Pressable>
                    )
                  })}
                </Flex>
              </>
            ) : null}
          </Box>

          {error ? (
            <Text fontSize="12px" color="app.red.secondary">
              {error}
            </Text>
          ) : null}

          <Flex gap="8px">
            <Pressable
              type="button"
              onClick={onClose}
              disabled={isPending}
              flex="1"
              minH="36px"
              borderRadius="10px"
              borderWidth="1px"
              borderColor="app.divider"
              bg="app.cardBackground"
              color="fg.muted"
              fontSize="13px"
              fontWeight="700"
              cursor="pointer"
              _hover={{ color: "fg", bg: "bg.subtle" }}
            >
              Cancel
            </Pressable>
            <Pressable
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              flex="1"
              minH="36px"
              borderRadius="10px"
              borderWidth="1px"
              borderColor="app.tint"
              bg="app.tint"
              color="app.pillActiveText"
              fontSize="13px"
              fontWeight="700"
              cursor="pointer"
              _hover={{ filter: "brightness(1.05)" }}
              _disabled={{ opacity: 0.5, cursor: "default", filter: "none" }}
            >
              {isPending ? "Saving…" : "Save"}
            </Pressable>
          </Flex>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

export default SavePresetDialog
