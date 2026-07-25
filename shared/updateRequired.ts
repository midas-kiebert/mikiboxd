/**
 * Client-version gate: the backend rejects requests from mobile app builds
 * older than its configured minimum with 426 Upgrade Required (see
 * `backend/app/core/middleware.py`). This interceptor catches that response
 * and hands the details to a callback so the app can show a blocking
 * "please update" screen instead of whatever broke on the actual request.
 *
 * Mirrors the shape of `authRefresh.ts` — a single global axios interceptor
 * that covers every generated-client call without touching generated code.
 */
import axios from 'axios';
import type { AxiosError } from 'axios';

export type UpdateRequiredInfo = {
  minSupportedVersion: string | null;
  storeUrl: string | null;
};

type UpdateRequiredResponseBody = {
  min_supported_version?: string;
  store_url?: string | null;
};

const isUpdateRequiredBody = (data: unknown): data is UpdateRequiredResponseBody =>
  typeof data === 'object' && data !== null;

export function installUpdateRequiredInterceptor(
  onUpdateRequired: (info: UpdateRequiredInfo) => void
): void {
  axios.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response?.status === 426) {
        const body = error.response.data;
        onUpdateRequired({
          minSupportedVersion: isUpdateRequiredBody(body)
            ? (body.min_supported_version ?? null)
            : null,
          storeUrl: isUpdateRequiredBody(body) ? (body.store_url ?? null) : null,
        });
      }
      return Promise.reject(error);
    }
  );
}
