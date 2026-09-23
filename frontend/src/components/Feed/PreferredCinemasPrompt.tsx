/**
 * "Set as preferred cinemas", with the two questions it can raise.
 *
 * A selection that is already one of your presets just becomes the preferred
 * one. Anything else is saved under the reserved name, "My Cinemas". Two
 * moves would quietly lose a "My Cinemas", so each asks first:
 *
 * - **Replace** — saving a new selection while a "My Cinemas" exists would
 *   overwrite its cinemas: replace them, or rename the old set to keep it.
 * - **Demote** — making another preset preferred while "My Cinemas" is the
 *   preferred one would leave it behind as a stray preset: delete it, or keep
 *   it as a preset (renamed, if you like).
 *
 * The decisions are `planSaveAsPreferred` / `planPromotePreset` in shared, so
 * the app asks the same questions at the same moments; this is only the web's
 * dialog. Drawn by hand rather than with Chakra's dialog, which layers below
 * the cinema sheet (`SHEET_Z_INDEX`) that this has to open over.
 */
import { Box, Flex, Portal, Text, chakra } from "@chakra-ui/react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { ApiError, type CinemaPresetPublic } from "shared/client"
import {
  describeDemotePreferredPrompt,
  describeReplacePreferredPrompt,
} from "shared/filters/cinema-presets"

import type { CinemaPresetState } from "@/features/showtimes/use-cinema-preset-state"

const Pressable = chakra("button")
const NameInput = chakra("input")

/** Above the cinema sheet (2100) and its scrim, which it opens over. */
const PROMPT_Z_INDEX = 2300

type Pending = (
  | { kind: "replace"; cinemaIds: number[] }
  | { kind: "demote"; preset: CinemaPresetPublic }
) & {
  reserved: CinemaPresetPublic
  /** Null until renaming is chosen; then the name being typed. */
  renameTo: string | null
  error: string | null
}

const errorMessage = (caught: unknown) =>
  caught instanceof ApiError && caught.status === 409
    ? "You already have a preset with that name."
    : "Could not save. Please try again."

export const usePreferredCinemasSave = (presetState: CinemaPresetState) => {
  const [pending, setPending] = useState<Pending | null>(null)
  const fail = (caught: unknown) =>
    setPending((current) =>
      current ? { ...current, error: errorMessage(caught) } : current,
    )

  /** Make a saved preset the preferred one — asks first if that demotes "My Cinemas". */
  const promote = (preset: CinemaPresetPublic) => {
    if (preset.is_favorite) return
    const plan = presetState.planPromote(preset)
    if (plan.kind === "confirm-demote") {
      setPending({
        kind: "demote",
        preset,
        reserved: plan.reserved,
        renameTo: null,
        error: null,
      })
      return
    }
    presetState.makePresetPreferred(preset.id)
  }

  const save = (cinemaIds: number[]) => {
    if (cinemaIds.length === 0) return
    const plan = presetState.planPreferred(cinemaIds)
    if (plan.kind === "promote" || plan.kind === "confirm-demote") {
      promote(plan.preset)
      return
    }
    if (plan.kind === "create") {
      void presetState.saveAsPreferred(cinemaIds).catch(() => undefined)
      return
    }
    setPending({
      kind: "replace",
      cinemaIds,
      reserved: plan.reserved,
      renameTo: null,
      error: null,
    })
  }

  /** Replace: overwrite "My Cinemas". Demote: delete it. */
  const discardReserved = async () => {
    if (!pending) return
    try {
      if (pending.kind === "replace") {
        void presetState
          .saveAsPreferred(pending.cinemaIds)
          .catch(() => undefined)
      } else {
        await presetState.promoteOverReserved({
          presetId: pending.preset.id,
          reserved: { presetId: pending.reserved.id, action: "delete" },
        })
      }
      setPending(null)
    } catch (caught) {
      fail(caught)
    }
  }

  /** Keep the old "My Cinemas" as a preset under the typed name, then go ahead. */
  const keepReserved = async () => {
    if (!pending || pending.renameTo === null) return
    const name = pending.renameTo.trim()
    if (!name) return
    const isSameName = name === pending.reserved.name
    try {
      if (pending.kind === "replace") {
        // Replacing needs the name free for the new selection.
        if (isSameName) {
          setPending({
            ...pending,
            error: "Pick a different name for the old set.",
          })
          return
        }
        await presetState.saveAsPreferred(pending.cinemaIds, {
          presetId: pending.reserved.id,
          name,
        })
      } else {
        await presetState.promoteOverReserved({
          presetId: pending.preset.id,
          reserved: {
            presetId: pending.reserved.id,
            action: "keep",
            name: isSameName ? null : name,
          },
        })
      }
      setPending(null)
    } catch (caught) {
      fail(caught)
    }
  }

  const prompt = pending ? (
    <PreferredCinemasDialog
      pending={pending}
      isSaving={
        presetState.isSavingPreferred || presetState.isPromotingOverReserved
      }
      onCancel={() => setPending(null)}
      onDiscard={() => void discardReserved()}
      onStartRename={() =>
        setPending({
          ...pending,
          renameTo: presetState.suggestedRenameForReserved,
          error: null,
        })
      }
      onRenameChange={(renameTo) =>
        setPending({ ...pending, renameTo, error: null })
      }
      onKeep={() => void keepReserved()}
    />
  ) : null

  return { save, promote, prompt }
}

const DialogButton = ({
  label,
  onClick,
  tone = "secondary",
  disabled = false,
}: {
  label: string
  onClick: () => void
  tone?: "primary" | "secondary" | "destructive"
  disabled?: boolean
}) => (
  <Pressable
    type="button"
    onClick={onClick}
    disabled={disabled}
    px="14px"
    py="8px"
    borderRadius="10px"
    borderWidth="1.5px"
    borderColor={
      tone === "primary"
        ? "app.tint"
        : tone === "destructive"
          ? "app.red.primary"
          : "app.divider"
    }
    bg={
      tone === "primary"
        ? "app.tint"
        : tone === "destructive"
          ? "app.red.primary"
          : "transparent"
    }
    color={
      tone === "primary"
        ? "app.pillActiveText"
        : tone === "destructive"
          ? "app.red.secondary"
          : "fg"
    }
    fontSize="13px"
    fontWeight="700"
    cursor="pointer"
    _hover={
      tone === "secondary"
        ? { bg: "bg.subtle" }
        : { filter: "brightness(1.05)" }
    }
    _disabled={{ opacity: 0.5, cursor: "default" }}
  >
    {label}
  </Pressable>
)

/** The labels each question needs, in one shape. */
const describe = (pending: Pending) => {
  if (pending.kind === "replace") {
    const copy = describeReplacePreferredPrompt(pending.reserved)
    return {
      title: copy.title,
      body: copy.body,
      discardLabel: copy.replaceLabel,
      discardTone: "primary" as const,
      keepLabel: copy.renameLabel,
      keepConfirmLabel: copy.renameConfirmLabel,
      renamePlaceholder: copy.renamePlaceholder,
    }
  }
  const copy = describeDemotePreferredPrompt(pending.reserved, pending.preset)
  return {
    title: copy.title,
    body: copy.body,
    discardLabel: copy.deleteLabel,
    discardTone: "destructive" as const,
    keepLabel: copy.keepLabel,
    keepConfirmLabel: copy.keepConfirmLabel,
    renamePlaceholder: copy.renamePlaceholder,
  }
}

const PreferredCinemasDialog = ({
  pending,
  isSaving,
  onCancel,
  onDiscard,
  onStartRename,
  onRenameChange,
  onKeep,
}: {
  pending: Pending
  isSaving: boolean
  onCancel: () => void
  onDiscard: () => void
  onStartRename: () => void
  onRenameChange: (name: string) => void
  onKeep: () => void
}) => {
  const copy = describe(pending)
  const isRenaming = pending.renameTo !== null
  const cancelRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus inside, so Esc lands here first and closes only this — the cinema
  // sheet underneath listens for Esc on the document.
  useEffect(() => {
    if (isRenaming) inputRef.current?.select()
    else cancelRef.current?.focus()
  }, [isRenaming])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.stopPropagation()
    onCancel()
  }

  return (
    <Portal>
      <Flex
        position="fixed"
        inset={0}
        zIndex={PROMPT_Z_INDEX}
        align="center"
        justify="center"
        px="16px"
        onKeyDown={onKeyDown}
      >
        <Box
          position="absolute"
          inset={0}
          bg={{ base: "blackAlpha.500", _dark: "blackAlpha.700" }}
          onClick={onCancel}
          aria-hidden
        />
        <Box
          role="alertdialog"
          aria-modal
          aria-label={copy.title}
          position="relative"
          w="100%"
          maxW="400px"
          p="18px"
          borderRadius="14px"
          borderWidth="1px"
          borderColor="border"
          bg="bg.panel"
          boxShadow="0 18px 50px rgba(0, 0, 0, 0.28)"
        >
          <Text fontSize="16px" fontWeight="800" color="fg" mb="6px">
            {copy.title}
          </Text>
          <Text fontSize="13px" color="fg.muted" lineHeight="1.45">
            {copy.body}
          </Text>
          {isRenaming ? (
            <Box mt="12px">
              <NameInput
                ref={inputRef}
                value={pending.renameTo ?? ""}
                onChange={(event) => onRenameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onKeep()
                }}
                placeholder={copy.renamePlaceholder}
                aria-label={copy.renamePlaceholder}
                maxLength={80}
                w="100%"
                h="36px"
                px="10px"
                borderRadius="8px"
                borderWidth="1px"
                borderColor="app.pillBorder"
                bg="app.searchBackground"
                color="fg"
                fontSize="14px"
                outline="none"
                _focusVisible={{ borderColor: "app.tint" }}
              />
            </Box>
          ) : null}
          {pending.error ? (
            <Text fontSize="12px" color="app.red.secondary" mt="6px">
              {pending.error}
            </Text>
          ) : null}
          <Flex mt="16px" gap="8px" justify="flex-end" wrap="wrap">
            <Pressable
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              px="10px"
              py="8px"
              borderRadius="10px"
              bg="transparent"
              color="fg.muted"
              fontSize="13px"
              fontWeight="700"
              cursor="pointer"
              _hover={{ color: "fg" }}
            >
              Cancel
            </Pressable>
            {isRenaming ? (
              <DialogButton
                tone="primary"
                label={isSaving ? "Saving…" : copy.keepConfirmLabel}
                onClick={onKeep}
                disabled={isSaving || !pending.renameTo?.trim()}
              />
            ) : (
              <>
                <DialogButton
                  label={copy.keepLabel}
                  onClick={onStartRename}
                  disabled={isSaving}
                />
                <DialogButton
                  tone={copy.discardTone}
                  label={copy.discardLabel}
                  onClick={onDiscard}
                  disabled={isSaving}
                />
              </>
            )}
          </Flex>
        </Box>
      </Flex>
    </Portal>
  )
}
