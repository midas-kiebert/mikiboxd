/**
 * Transparent access-token refresh.
 *
 * Access tokens are short-lived; when one expires the backend returns 401. This
 * interceptor catches that 401, exchanges the stored refresh token for a fresh
 * access + refresh pair, and retries the original request — so the user never
 * sees the lapse. Only when the refresh itself fails (refresh token missing,
 * expired, or rejected) do we give up and hand off to `onRefreshFailed`, which
 * clears the session and routes back to login (the existing 401 handler).
 *
 * The generated API client delegates to the default `axios` instance, so a
 * single global interceptor here covers every API call without touching
 * generated code.
 */
import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { OpenAPI } from './client';
import type { Token } from './client';
import { storage } from './storage';

const REFRESH_PATH = '/api/v1/login/refresh-token';

/**
 * Axios waits forever by default, so a socket that stalls without erroring —
 * a flaky mobile network, a connection dropped while backgrounded — leaves the
 * request promise permanently pending: no result, no error, and no way for a
 * caller to tell it has been abandoned. Anything polling on it (the email
 * verification badge, say) then sits on "checking" indefinitely. Generous
 * enough that genuinely slow endpoints still finish; the point is only that
 * every request eventually settles.
 */
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * Tighter than the general one: a refresh that never settles wedges not just
 * itself but every later 401, which all await the same in-flight promise.
 */
const REFRESH_TIMEOUT_MS = 15_000;

// In-flight refresh shared by all requests that 401 at once, so a burst of
// concurrent failures triggers exactly one refresh.
let refreshPromise: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  const refreshToken = await storage.getItem('refresh_token');
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  // A bare client (no interceptors) so a 401 from the refresh endpoint itself
  // can never recurse back into this handler.
  const response = await axios.create({ timeout: REFRESH_TIMEOUT_MS }).post<Token>(
    `${OpenAPI.BASE}${REFRESH_PATH}`,
    { refresh_token: refreshToken },
  );
  await storage.setItem('access_token', response.data.access_token);
  await storage.setItem('refresh_token', response.data.refresh_token);
  return response.data.access_token;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

export function installAuthRefreshInterceptor(onRefreshFailed: () => void): void {
  // Set here rather than in the generated client, which regeneration would
  // overwrite. `axios.create()` inherits the defaults, so this bounds the
  // refresh client below as well as every generated API call.
  axios.defaults.timeout = REQUEST_TIMEOUT_MS;

  axios.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetriableConfig | undefined;
      const status = error.response?.status;

      // No credential was sent, so this 401 cannot be an expired one. It is a
      // signed-out visitor reaching an endpoint that needs an account — there
      // is nothing to refresh, and treating it as a dead session would tear
      // down a session that was never there. (The generated client omits the
      // header entirely when it has no token; see `getHeaders`.)
      const requestWasAuthenticated = Boolean(config?.headers?.Authorization);

      const shouldAttemptRefresh =
        status === 401 &&
        !!config &&
        requestWasAuthenticated &&
        !config._retriedAfterRefresh &&
        !(config.url ?? '').includes(REFRESH_PATH);

      if (!shouldAttemptRefresh || !config) {
        return Promise.reject(error);
      }

      config._retriedAfterRefresh = true;
      try {
        if (!refreshPromise) {
          refreshPromise = performRefresh().finally(() => {
            refreshPromise = null;
          });
        }
        const newAccessToken = await refreshPromise;
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>).Authorization = `Bearer ${newAccessToken}`;
        return axios(config);
      } catch {
        // Refresh failed — the session is dead. Clear it and let the original
        // 401 propagate to the react-query handler, which redirects to login.
        await storage.removeItem('access_token');
        await storage.removeItem('refresh_token');
        onRefreshFailed();
        return Promise.reject(error);
      }
    },
  );
}
