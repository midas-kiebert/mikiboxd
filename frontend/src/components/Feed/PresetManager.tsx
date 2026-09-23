/**
 * Managing cinema presets inside the cinema sheet: the list, and the form that
 * saves a new one.
 *
 * The words are the app's (`CinemaFilterModal`'s "Manage presets" page): "Your
 * preferred cinemas" pinned above "Saved presets", "The cinemas your feed
 * starts with", and per preset **Edit**, **Set as preferred cinemas**
 * and **Delete** — worded rather than bare icons, because each changes saved
 * data. Deleting asks first, in place rather than in a dialog over the sheet.
 *
 * One card per preset, as on the app's page. Your preferred cinemas go by their
 * own name — the section heading above them already says what they are.
 */
import { Box, Flex, Text, chakra } from "@chakra-ui/react"
import { type KeyboardEvent, type ReactNode, useState } from "react"
import {
  MdDeleteOutline,
  MdEdit,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdStarBorder,
} from "react-icons/md"
import { ApiError, type CinemaPresetPublic } from "shared/client"
import { serializeCinemaIds } from "shared/filters/cinema-grouping"
import { formatCinemaCount } from "shared/filters/cinema-selection"

import type { CinemaPresetState } from "@/features/showtimes/use-cinema-preset-state"

const Pressable = chakra("button")
const NameInput = chakra("input")

/** The uppercase heading the app gives each part of the page. */
const SectionTitle = ({ children }: { children: string }) => (
  <Text
    fontSize="12px"
    fontWeight="700"
    color="fg.muted"
    textTransform="uppercase"
    letterSpacing="0.6px"
    mt="4px"
    mb="4px"
  >
    {children}
  </Text>
)

const Hint = ({ children }: { children: string }) => (
  <Text fontSize="12px" color="fg.muted" mb="8px">
    {children}
  </Text>
)

/** A worded action under a preset: an icon for recognition, a word for meaning. */
const PresetAction = ({
  icon,
  label,
  onClick,
  isDestructive = false,
  disabled = false,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  isDestructive?: boolean
  disabled?: boolean
}) => (
  <Pressable
    type="button"
    onClick={onClick}
    disabled={disabled}
    display="inline-flex"
    alignItems="center"
    gap="4px"
    bg="transparent"
    color={isDestructive ? "app.red.secondary" : "fg.muted"}
    fontSize="12px"
    fontWeight="600"
    cursor="pointer"
    _hover={{ color: isDestructive ? "app.red.secondary" : "fg" }}
    _disabled={{ opacity: 0.5, cursor: "default" }}
  >
    {icon}
    <Box as="span" position="relative" top="1px">
      {label}
    </Box>
  </Pressable>
)

const ArrowButton = ({
  direction,
  onClick,
  disabled,
}: {
  direction: "up" | "down"
  onClick: () => void
  disabled: boolean
}) => (
  <Pressable
    type="button"
    aria-label={direction === "up" ? "Move preset up" : "Move preset down"}
    onClick={onClick}
    disabled={disabled}
    display="flex"
    bg="transparent"
    color="fg.muted"
    cursor="pointer"
    borderRadius="6px"
    _hover={{ bg: "bg.subtle" }}
    _disabled={{ opacity: 0.3, cursor: "default", bg: "transparent" }}
  >
    {direction === "up" ? (
      <MdKeyboardArrowUp size={20} />
    ) : (
      <MdKeyboardArrowDown size={20} />
    )}
  </Pressable>
)

/** "Delete preset?" in the place the actions were, so the sheet never stacks a dialog. */
const ConfirmDelete = ({
  onCancel,
  onConfirm,
  isPending,
}: {
  onCancel: () => void
  onConfirm: () => void
  isPending: boolean
}) => (
  <Flex align="center" gap="10px" mt="8px" wrap="wrap">
    <Text fontSize="12px" fontWeight="700" color="fg" flex="1">
      Delete preset?
    </Text>
    <Pressable
      type="button"
      onClick={onCancel}
      bg="transparent"
      color="fg.muted"
      fontSize="12px"
      fontWeight="600"
      cursor="pointer"
    >
      Cancel
    </Pressable>
    <Pressable
      type="button"
      onClick={onConfirm}
      disabled={isPending}
      px="10px"
      py="4px"
      borderRadius="8px"
      bg="app.red.primary"
      color="app.red.secondary"
      fontSize="12px"
      fontWeight="700"
      cursor="pointer"
      _disabled={{ opacity: 0.6 }}
    >
      {isPending ? "Deleting..." : "Delete"}
    </Pressable>
  </Flex>
)

/**
 * Name a new preset from the sheet's selection. Prefilled, so saving never
 * *requires* typing; a clash turns Save into Replace rather than failing.
 */
export const SavePresetForm = ({
  presetState,
  cinemaIds,
  onDone,
}: {
  presetState: CinemaPresetState
  cinemaIds: number[]
  onDone: () => void
}) => {
  const [name, setName] = useState(presetState.suggestedName)
  const [error, setError] = useState<string | null>(null)
  const [isReplacing, setIsReplacing] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Enter a preset name.")
      return
    }
    try {
      await presetState.createPreset({
        name: trimmed,
        cinemaIds,
        overwrite: isReplacing,
      })
      onDone()
    } catch (caught) {
      // 409 is a question, not a failure: keep the name and let the next click
      // replace what is there.
      if (caught instanceof ApiError && caught.status === 409) {
        setIsReplacing(true)
        setError("You already have a preset with that name.")
        return
      }
      setError("Could not save cinema preset. Please try again.")
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void submit()
    if (event.key === "Escape") {
      // Closes the form, not the whole sheet behind it.
      event.stopPropagation()
      onDone()
    }
  }

  return (
    <Box>
      <Text fontSize="12px" fontWeight="700" color="fg" mb="6px">
        Save as preset
        <Box as="span" fontWeight="500" color="fg.muted">
          {" · "}
          {formatCinemaCount(cinemaIds.length)}
        </Box>
      </Text>
      <Flex gap="8px" align="center">
        <NameInput
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
            setIsReplacing(false)
          }}
          onFocus={(event) => event.target.select()}
          onKeyDown={onKeyDown}
          placeholder="Cinema preset name"
          maxLength={80}
          flex="1"
          minW={0}
          h="34px"
          px="10px"
          borderRadius="8px"
          borderWidth="1px"
          borderColor={error ? "app.red.border" : "app.pillBorder"}
          bg="app.searchBackground"
          color="fg"
          fontSize="13px"
          outline="none"
          _focusVisible={{ borderColor: "app.tint" }}
        />
        <Pressable
          type="button"
          onClick={onDone}
          bg="transparent"
          color="fg.muted"
          fontSize="13px"
          fontWeight="600"
          cursor="pointer"
          px="4px"
        >
          Cancel
        </Pressable>
        <Pressable
          type="button"
          onClick={() => void submit()}
          disabled={presetState.isCreating}
          h="34px"
          px="14px"
          borderRadius="8px"
          bg="app.tint"
          color="app.pillActiveText"
          fontSize="13px"
          fontWeight="700"
          cursor="pointer"
          _disabled={{ opacity: 0.6 }}
        >
          {presetState.isCreating
            ? "Saving..."
            : isReplacing
              ? "Replace"
              : "Save"}
        </Pressable>
      </Flex>
      {error ? (
        <Text fontSize="12px" color="app.red.secondary" mt="6px">
          {error}
        </Text>
      ) : null}
    </Box>
  )
}

type ListProps = {
  presetState: CinemaPresetState
  /** The sheet's selection, so the preset it already is can say so. */
  draftIds: number[]
  onApply: (cinemaIds: number[]) => void
  onEdit: (preset: CinemaPresetPublic) => void
  /** "Set as preferred cinemas" — may ask about "My Cinemas" first. */
  onMakePreferred: (preset: CinemaPresetPublic) => void
}

/** The app's "Manage presets" page, a card per preset. */
export const PresetManager = ({
  presetState,
  draftIds,
  onApply,
  onEdit,
  onMakePreferred,
}: ListProps) => {
  const [confirming, setConfirming] = useState<string | null>(null)
  const { preferred, named } = presetState
  const draftSignature = serializeCinemaIds(draftIds)

  const card = (
    preset: CinemaPresetPublic,
    children: ReactNode,
    header?: ReactNode,
  ) => {
    const isCurrent = serializeCinemaIds(preset.cinema_ids) === draftSignature
    return (
      <Box
        key={preset.id}
        borderRadius="12px"
        borderWidth="1px"
        borderColor={isCurrent ? "app.green.border" : "app.divider"}
        bg="bg.panel"
        px="12px"
        py="10px"
        mb="8px"
      >
        <Flex align="center" gap="6px">
          <Pressable
            type="button"
            onClick={() => onApply(preset.cinema_ids)}
            aria-label={`Apply ${preset.name}`}
            flex="1"
            minW={0}
            textAlign="left"
            bg="transparent"
            cursor="pointer"
          >
            {/* Wraps: a preset is told apart by its name, so it is never cut off. */}
            <Text fontSize="14px" fontWeight="600" color="fg" lineClamp={2}>
              {preset.name}
            </Text>
            <Text fontSize="11px" color="fg.muted" truncate>
              {formatCinemaCount(preset.cinema_ids.length)}
              {isCurrent ? " · selected now" : ""}
            </Text>
          </Pressable>
          {header}
        </Flex>
        {children}
      </Box>
    )
  }

  return (
    <Box>
      {/* Pinned above the presets and never reordered: it is not one of them,
          it is the selection every visit falls back to. */}
      <SectionTitle>Your preferred cinemas</SectionTitle>
      <Hint>The cinemas your feed starts with.</Hint>
      {preferred ? (
        card(
          preferred,
          <Flex gap="14px" mt="8px">
            <PresetAction
              icon={<MdEdit size={15} />}
              label="Edit"
              onClick={() => onEdit(preferred)}
            />
          </Flex>,
        )
      ) : (
        <Box
          borderRadius="12px"
          borderWidth="1px"
          borderColor="app.divider"
          bg="bg.panel"
          px="12px"
          py="10px"
          mb="8px"
        >
          <Text fontSize="11px" color="fg.muted">
            Not set yet. Pick your preferred cinemas and click “Set as preferred
            cinemas”.
          </Text>
        </Box>
      )}

      <SectionTitle>Saved presets</SectionTitle>
      {named.length === 0 ? (
        <Text fontSize="13px" color="fg.muted" py="10px">
          No saved presets.
        </Text>
      ) : (
        <>
          <Hint>
            Click a preset to apply it to the picker. Use the arrows to reorder.
          </Hint>
          {named.map((preset, index) =>
            card(
              preset,
              confirming === preset.id ? (
                <ConfirmDelete
                  onCancel={() => setConfirming(null)}
                  isPending={presetState.isDeleting}
                  onConfirm={() => {
                    void presetState
                      .deletePreset(preset.id)
                      .then(() => setConfirming(null))
                  }}
                />
              ) : (
                <Flex gap="14px" mt="8px" wrap="wrap">
                  <PresetAction
                    icon={<MdEdit size={15} />}
                    label="Edit"
                    onClick={() => onEdit(preset)}
                  />
                  <PresetAction
                    icon={<MdStarBorder size={15} />}
                    label="Set as preferred cinemas"
                    onClick={() => onMakePreferred(preset)}
                  />
                  <PresetAction
                    icon={<MdDeleteOutline size={15} />}
                    label="Delete"
                    isDestructive
                    onClick={() => setConfirming(preset.id)}
                  />
                </Flex>
              ),
              <>
                <ArrowButton
                  direction="up"
                  disabled={index === 0}
                  onClick={() => presetState.movePreset(index, index - 1)}
                />
                <ArrowButton
                  direction="down"
                  disabled={index === named.length - 1}
                  onClick={() => presetState.movePreset(index, index + 1)}
                />
              </>,
            ),
          )}
        </>
      )}
    </Box>
  )
}
