import { usernameMinLength } from 'shared/utils';

// Anything outside the characters `usernamePattern` allows. One of these can
// never become valid by typing more, so it is worth saying so straight away.
const INVALID_USERNAME_CHARACTER = /[^A-Za-z0-9_]/;

/**
 * Whether a username being typed should be checked on this keystroke rather
 * than waiting for the field to lose focus.
 *
 * Yes as soon as it holds a character that is never allowed, or once it is
 * long enough to be valid (so a name the user has fixed clears its error as
 * they type). Not for a name that is merely still too short: "must be 4-15
 * characters" on the first letter reads as a telling-off for not being done.
 * The field's blur still catches that one.
 */
export function shouldValidateUsernameWhileTyping(value: string): boolean {
  return INVALID_USERNAME_CHARACTER.test(value) || value.length >= usernameMinLength;
}
