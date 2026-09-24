/**
 * Cineville: your pass number, kept in this browser only — the app's Cineville
 * card, which a guest gets too.
 *
 * Once saved it can be shown as the pass's barcode (for a scanner, or a
 * phone's browser at the door), copied with its `CP$` prefix, and copied on
 * its own whenever you open a Cineville cinema's ticket link, ready to paste
 * into the ticket shop (`copyCinevilleCardForTicketLink`).
 *
 * The app's "shortcut button" switches are not here: the website has no
 * floating pass button for them to show or hide.
 */
import { Portal } from "@chakra-ui/react"
import { useMemo, useState } from "react"
import { MdCheck, MdContentCopy } from "react-icons/md"
import { encodeCode128 } from "shared/cineville/code128"

import { FriendButton } from "@/components/Friends/friend-controls"
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CINEVILLE_DIGITS_LENGTH,
  CINEVILLE_PREFIX,
  buildCinevilleBarcodeValue,
  isValidCinevilleDigits,
  setCinevilleAutoCopyEnabled,
  setCinevilleCardDigits,
  useCinevilleAutoCopyEnabled,
  useCinevilleCardDigits,
} from "@/features/cineville/cineville-card"
import useCustomToast from "@/hooks/useCustomToast"

import {
  SettingsField,
  SettingsRow,
  SettingsSection,
  Switch,
} from "./settings-controls"
import { sectionMeta } from "./settings-sections"

/** How long "Copied" stays on the button. */
const COPIED_RESET_MS = 1500

const CinevilleSection = () => {
  // Read flow: stored card and draft first, then handlers, then JSX.
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const meta = sectionMeta("cineville")
  const savedDigits = useCinevilleCardDigits()
  const isAutoCopyEnabled = useCinevilleAutoCopyEnabled()
  const [draft, setDraft] = useState(savedDigits ?? "")
  const [error, setError] = useState<string | null>(null)
  const [didCopy, setDidCopy] = useState(false)
  const [isPassOpen, setIsPassOpen] = useState(false)

  const trimmed = draft.trim()
  const isUnchanged = trimmed === (savedDigits ?? "")

  const handleSave = () => {
    setError(null)
    if (trimmed && !isValidCinevilleDigits(trimmed)) {
      setError(`The card number is exactly ${CINEVILLE_DIGITS_LENGTH} digits.`)
      return
    }
    setCinevilleCardDigits(trimmed || null)
    showSuccessToast(
      trimmed
        ? "Cineville card saved in this browser."
        : "Cineville card removed.",
    )
  }

  const handleCopy = async () => {
    if (!savedDigits) return
    try {
      await navigator.clipboard.writeText(
        buildCinevilleBarcodeValue(savedDigits),
      )
      setDidCopy(true)
      window.setTimeout(() => setDidCopy(false), COPIED_RESET_MS)
    } catch {
      showErrorToast("Could not copy the code.")
    }
  }

  return (
    <SettingsSection
      id="cineville"
      title="Cineville"
      icon={meta.icon}
      description="Your Cineville card number is stored only in this browser and never shared."
    >
      <div className="st-card">
        <form
          className="st-card__body"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isUnchanged) handleSave()
          }}
        >
          <SettingsField label="Card number" htmlFor="settings-cineville">
            <div className="st-affix">
              <span className="st-affix__prefix st-affix__prefix--boxed">
                {CINEVILLE_PREFIX}
              </span>
              <input
                id="settings-cineville"
                className="st-input"
                value={draft}
                onChange={(event) =>
                  setDraft(
                    event.target.value
                      .replace(/\D/g, "")
                      .slice(0, CINEVILLE_DIGITS_LENGTH),
                  )
                }
                placeholder="000000000"
                inputMode="numeric"
                autoComplete="off"
                maxLength={CINEVILLE_DIGITS_LENGTH}
              />
            </div>
          </SettingsField>
          {error ? <p className="st-error">{error}</p> : null}
          <div className="st-actions st-actions--end">
            {savedDigits ? (
              <>
                <FriendButton
                  icon={<BarcodeIcon size={16} />}
                  onClick={() => setIsPassOpen(true)}
                >
                  Show barcode
                </FriendButton>
                <FriendButton
                  icon={
                    didCopy ? (
                      <MdCheck size={15} />
                    ) : (
                      <MdContentCopy size={15} />
                    )
                  }
                  onClick={() => void handleCopy()}
                >
                  {didCopy ? "Copied" : "Copy code"}
                </FriendButton>
              </>
            ) : null}
            <FriendButton primary busy={isUnchanged} onClick={handleSave}>
              {trimmed || !savedDigits ? "Save card" : "Remove card"}
            </FriendButton>
          </div>
        </form>
        {savedDigits ? (
          <SettingsRow
            title="Copy code when opening a ticket link"
            description="At a Cineville cinema, opening the ticket link puts your card number on the clipboard."
          >
            <Switch
              checked={isAutoCopyEnabled}
              onChange={setCinevilleAutoCopyEnabled}
              label="Copy code when opening a ticket link"
            />
          </SettingsRow>
        ) : null}
      </div>

      {savedDigits ? (
        <DialogRoot
          open={isPassOpen}
          onOpenChange={(details) => setIsPassOpen(details.open)}
          placement="center"
          size="md"
        >
          <Portal>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cineville pass</DialogTitle>
              </DialogHeader>
              <DialogCloseTrigger />
              <DialogBody pb={6}>
                <div className="st-pass">
                  <Barcode value={buildCinevilleBarcodeValue(savedDigits)} />
                  <span className="st-pass__code">
                    {buildCinevilleBarcodeValue(savedDigits)}
                  </span>
                </div>
              </DialogBody>
            </DialogContent>
          </Portal>
        </DialogRoot>
      ) : null}
    </SettingsSection>
  )
}

/**
 * The app's barcode icon (MaterialCommunityIcons `barcode`), which no icon set
 * the website ships includes — its outline, taken from the app's icon font.
 */
const BarcodeIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M2 6h2v12H2zm3 0h1v12H5zm2 0h3v12H7zm4 0h1v12h-1zm3 0h2v12h-2zm3 0h3v12h-3zm4 0h1v12h-1z" />
  </svg>
)

/** Blank margin Code 128 needs on both sides for a scanner to find the code. */
const QUIET_ZONE_MODULES = 10
/** Screen pixels per module at full size; the SVG scales down to fit. */
const MODULE_PX = 3
const BARCODE_HEIGHT = 140

/**
 * The pass as a Code 128 barcode, from the encoder the app draws with. Black
 * on white whatever the theme, and edges left unsmoothed, since a scanner
 * reads contrast.
 */
const Barcode = ({ value }: { value: string }) => {
  const { bars, modules } = useMemo(() => {
    const encoding = encodeCode128(value)
    const result: { x: number; width: number }[] = []
    let offset = QUIET_ZONE_MODULES
    encoding.elementWidths.forEach((width, index) => {
      // Every other element is a bar, starting with the first.
      if (index % 2 === 0) result.push({ x: offset, width })
      offset += width
    })
    return {
      bars: result,
      modules: encoding.totalModules + QUIET_ZONE_MODULES * 2,
    }
  }, [value])

  return (
    <svg
      width={modules * MODULE_PX}
      height={BARCODE_HEIGHT}
      viewBox={`0 0 ${modules} ${BARCODE_HEIGHT}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Barcode for ${value}`}
    >
      <rect
        x={0}
        y={0}
        width={modules}
        height={BARCODE_HEIGHT}
        fill="#ffffff"
      />
      {bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={0}
          width={bar.width}
          height={BARCODE_HEIGHT}
          fill="#000000"
        />
      ))}
    </svg>
  )
}

export default CinevilleSection
