/**
 * The frame the login and signup pages share, and their fields.
 *
 * These pages sit outside `_layout`, so they have no nav bar; the brand stands
 * in for it (it links home), with "Browse without an account" at the foot. Beneath the form is a second card
 * with a real button to the other form — "Sign up" used to be a highlighted
 * word at the foot of the login page, easy to miss for the one visitor it is
 * for.
 */
import { Link } from "@tanstack/react-router"
import {
  type InputHTMLAttributes,
  type ReactNode,
  forwardRef,
  useState,
} from "react"
import { MdVisibility, MdVisibilityOff } from "react-icons/md"

import NavBrand from "@/components/Common/NavBrand"
import { defaultFeedParams } from "@/features/showtimes/feed-params"

import "./auth.css"

type AuthShellProps = {
  title: string
  lede: string
  children: ReactNode
  /** Above the title, on a page that reports an outcome, like /verify-email. */
  icon?: ReactNode
  /** The card under the form: the way to the other form. Absent on pages
   *  that are a step of signing in rather than a form, like /pick-username. */
  switchTo?: { text: string; label: string; to: "/login" | "/signup" }
}

export const AuthShell = ({
  title,
  lede,
  children,
  icon,
  switchTo,
}: AuthShellProps) => (
  <div className="au-page">
    <div className="au-top">
      <NavBrand />
    </div>
    <main className="au-main">
      <header className="au-head">
        {icon}
        <h1 className="au-title">{title}</h1>
        <p className="au-lede">{lede}</p>
      </header>
      {children}
      {switchTo ? (
        <>
          <div className="au-switch">
            <p className="au-switch__text">{switchTo.text}</p>
            <Link to={switchTo.to} className="au-button">
              {switchTo.label}
            </Link>
          </div>
          <p className="au-guest">
            Just looking?{" "}
            <Link to="/" search={defaultFeedParams}>
              Browse without an account
            </Link>
          </p>
        </>
      ) : null}
    </main>
  </div>
)

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  error?: string
  /** Beside the label, e.g. "Forgot password?". */
  aside?: ReactNode
}

export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(
  function AuthField(
    { id, label, error, aside, type, className, ...input },
    ref,
  ) {
    const isPassword = type === "password"
    const [isShown, setIsShown] = useState(false)

    return (
      <div className="au-field">
        <div className="au-field__row">
          <label className="au-label" htmlFor={id}>
            {label}
          </label>
          {aside}
        </div>
        <div className="au-input-wrap">
          <input
            ref={ref}
            id={id}
            type={isPassword && isShown ? "text" : type}
            className={
              isPassword ? "au-input au-input--with-toggle" : "au-input"
            }
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            {...input}
          />
          {isPassword ? (
            <button
              type="button"
              className="au-toggle"
              // Out of the tab order: Tab should go field to field, not stop on
              // the eye between the password and whatever follows it.
              tabIndex={-1}
              onClick={() => setIsShown((shown) => !shown)}
              aria-label={isShown ? "Hide password" : "Show password"}
            >
              {isShown ? (
                <MdVisibilityOff size={18} />
              ) : (
                <MdVisibility size={18} />
              )}
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="au-error" id={`${id}-error`}>
            {error}
          </p>
        ) : null}
      </div>
    )
  },
)
