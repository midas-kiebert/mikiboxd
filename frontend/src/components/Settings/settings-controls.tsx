/**
 * The pieces every Settings section is built from, so the sections read as
 * one page: the section frame, the app's segmented control and switch, and
 * the confirm dialog that stands in for the app's `ConfirmDialog`.
 *
 * Drawn with the plain classes in `settings.css`, not Chakra props: a section
 * is mostly static text and a few controls, and the Friends and Activity pages
 * are built the same way.
 */
import { Portal, Text } from "@chakra-ui/react"
import type { ComponentType, ReactNode } from "react"

import { FriendButton } from "@/components/Friends/friend-controls"
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog"

import type { SettingsSectionId } from "./settings-sections"

type IconComponent = ComponentType<{
  className?: string
  "aria-hidden"?: boolean
}>

/** A titled block of the page, the target of an entry in the index. */
export const SettingsSection = ({
  id,
  title,
  icon: Icon,
  description,
  children,
}: {
  id: SettingsSectionId
  title: string
  icon: IconComponent
  description?: ReactNode
  children: ReactNode
}) => (
  <section id={id} className="st-section" aria-labelledby={`${id}-title`}>
    <div className="st-section__head">
      <Icon className="st-section__icon" aria-hidden />
      <h2 id={`${id}-title`} className="st-section__title">
        {title}
      </h2>
    </div>
    {description ? (
      <p className="st-section__description">{description}</p>
    ) : null}
    {children}
  </section>
)

/** A setting on one line: what it does on the left, its control on the right. */
export const SettingsRow = ({
  title,
  description,
  icon: Icon,
  isOff = false,
  isBusy = false,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: IconComponent
  /** Draws the icon and title muted, for a setting that is switched off. */
  isOff?: boolean
  isBusy?: boolean
  children?: ReactNode
}) => (
  <div className={`st-row st-row--wrap${isBusy ? " st-row--busy" : ""}`}>
    {Icon ? (
      <Icon
        className={`st-row__icon${isOff ? " st-row__icon--off" : ""}`}
        aria-hidden
      />
    ) : null}
    <div className="st-row__text">
      <span className={`st-row__title${isOff ? " st-row__title--off" : ""}`}>
        {title}
      </span>
      {description ? (
        <span className="st-row__description">{description}</span>
      ) : null}
    </div>
    {children}
  </div>
)

/** A labelled field; `aside` sits at the end of the label's line. */
export const SettingsField = ({
  label,
  htmlFor,
  aside,
  wide = false,
  children,
}: {
  label: string
  htmlFor?: string
  aside?: ReactNode
  /** Takes both columns of a `.st-fields` grid. */
  wide?: boolean
  children: ReactNode
}) => (
  <div className={`st-field${wide ? " st-field--wide" : ""}`}>
    <div className="st-field__label-row">
      <label className="st-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {aside}
    </div>
    {children}
  </div>
)

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: IconComponent
  /** The selected thumb stays neutral: for the choice that means "off". */
  neutral?: boolean
  /** Shown but not choosable; `title` says why. */
  disabled?: boolean
  title?: string
}

/** One exclusive choice, the app's `SegmentedControl`. */
export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  stretch = false,
  large = false,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** The group's accessible name, since the labels are terse. */
  label: string
  disabled?: boolean
  stretch?: boolean
  large?: boolean
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    className={`st-segmented${stretch ? " st-segmented--stretch" : ""}${large ? " st-segmented--large" : ""}`}
  >
    {options.map((option) => {
      const Icon = option.icon
      const isOn = option.value === value
      return (
        <button
          key={option.value}
          type="button"
          // biome-ignore lint/a11y/useSemanticElements: ARIA radio pattern on a styled button; a native radio input cannot take this styling
          role="radio"
          aria-checked={isOn}
          disabled={disabled || option.disabled}
          title={option.title}
          className={`st-segmented__option${option.neutral ? " st-segmented__option--neutral" : ""}`}
          onClick={() => {
            if (!isOn) onChange(option.value)
          }}
        >
          {Icon ? <Icon aria-hidden /> : null}
          <span className="st-segmented__label">{option.label}</span>
        </button>
      )
    })}
  </div>
)

/** The app's `AppSwitch`. */
export const Switch = ({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className="st-switch"
    onClick={() => onChange(!checked)}
  />
)

/**
 * The app's `ConfirmDialog`: a question, a cancel, and one or two answers.
 * Closed on the press itself; whatever the answer starts follows.
 */
export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  secondaryLabel,
  tone = "primary",
  closeOnConfirm = true,
  confirmBusy = false,
  onConfirm,
  onSecondary,
  onClose,
  children,
}: {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel: string
  /** `null` leaves the dialog with its answers only. */
  cancelLabel?: string | null
  secondaryLabel?: string
  tone?: "primary" | "destructive"
  /** False keeps the dialog up after the answer, for one that reports back. */
  closeOnConfirm?: boolean
  /** Greys the answer out once it has been given, for a dialog kept up. */
  confirmBusy?: boolean
  onConfirm: () => void
  onSecondary?: () => void
  onClose: () => void
  children?: ReactNode
}) => (
  <DialogRoot
    open={open}
    onOpenChange={(details) => {
      if (!details.open) onClose()
    }}
    role={tone === "destructive" ? "alertdialog" : "dialog"}
    placement="center"
  >
    <Portal>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {message ? (
            <Text fontSize="sm" color="app.textSecondary" whiteSpace="pre-line">
              {message}
            </Text>
          ) : null}
          {children}
        </DialogBody>
        <DialogFooter flexWrap="wrap">
          {cancelLabel ? (
            <FriendButton onClick={onClose}>{cancelLabel}</FriendButton>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <FriendButton
              onClick={() => {
                onClose()
                onSecondary()
              }}
            >
              {secondaryLabel}
            </FriendButton>
          ) : null}
          <FriendButton
            primary={tone === "primary"}
            destructive={tone === "destructive"}
            busy={!closeOnConfirm && confirmBusy}
            onClick={() => {
              if (closeOnConfirm) onClose()
              onConfirm()
            }}
          >
            {confirmLabel}
          </FriendButton>
        </DialogFooter>
      </DialogContent>
    </Portal>
  </DialogRoot>
)
