/**
 * Shared constants for the sign-in / sign-up screens.
 */

/**
 * Deliberately permissive: this only catches obvious typos before a round trip.
 * Whether an address actually exists is the backend's business.
 */
export const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/** Backend minimum for a new account's password. */
export const PASSWORD_MIN_LENGTH = 8;
