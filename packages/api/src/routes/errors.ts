import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError, ApiErrorCode } from '@lexica/shared';

/** Sends an error in the shared JSON shape (`{ error: { code, message } }`). */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
) {
  return c.json<ApiError>({ error: { code, message } }, status);
}

/**
 * Sends a 503 for a service that is down (Ollama, Qdrant). The cause is logged
 * for the developer; the user gets a message saying what to check.
 */
export function serviceUnavailable(
  c: Context,
  { code, message, cause }: { code: ApiErrorCode; message: string; cause?: unknown },
) {
  console.error(cause);
  return apiError(c, 503, code, message);
}
