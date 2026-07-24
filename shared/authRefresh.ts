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
  const response = await axios.create().post<Token>(
    `${OpenAPI.BASE}${REFRESH_PATH}`,
    { refresh_token: refreshToken },
  );
  await storage.setItem('access_token', response.data.access_token);
  await storage.setItem('refresh_token', response.data.refresh_token);
  return response.data.access_token;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

export function installAuthRefreshInterceptor(onRefreshFailed: () => void): void {
  axios.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetriableConfig | undefined;
      const status = error.response?.status;

      const shouldAttemptRefresh =
        status === 401 &&
        !!config &&
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
