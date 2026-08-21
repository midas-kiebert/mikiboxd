// Stores the protected deep-link path a logged-out user tried to open, so the
// login flow can resume it after authentication (e.g. /movie/123, /ping/1/abc).
//
// The value is JSON (`{ path, savedAt }`) — see `utils/pending-deep-link.ts`,
// which is the only thing that should read or write this key. Builds older than
// that change stored the bare path, which the reader still accepts.
export const PENDING_DEEP_LINK_PATH_KEY = "pending_deep_link_path_v1";
