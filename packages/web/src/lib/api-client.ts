import { apiErrorSchema } from '@lexica/shared';
import type { z } from 'zod';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/** Turns a failed response body into an error carrying the API's readable message. */
function toApiError(status: number, body: unknown): ApiRequestError {
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success
    ? new ApiRequestError(parsed.data.error.message, status, parsed.data.error.code)
    : new ApiRequestError(`Request failed with status ${status}`, status, 'HTTP_ERROR');
}

/**
 * Fetches a JSON endpoint of the Lexica API and validates the response with a
 * shared Zod schema, so the UI never works with data of an unexpected shape.
 */
export async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, body);
  return schema.parse(body);
}

/** Sends a DELETE request; resolves when the API confirms (2xx). */
export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
}

/**
 * Uploads one file as multipart form data (field `file`) and validates the
 * JSON response. Uses XMLHttpRequest because `fetch` cannot report upload
 * progress; `onProgress` receives a fraction between 0 and 1.
 */
export function apiUpload<T extends z.ZodType>(
  path: string,
  file: File,
  schema: T,
  onProgress?: (fraction: number) => void,
): Promise<z.infer<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body: unknown = xhr.response;
      if (xhr.status < 200 || xhr.status >= 300) return reject(toApiError(xhr.status, body));
      const parsed = schema.safeParse(body);
      if (parsed.success) resolve(parsed.data);
      else
        reject(
          new ApiRequestError('Unexpected response from the server', xhr.status, 'BAD_RESPONSE'),
        );
    };
    xhr.onerror = () =>
      reject(
        new ApiRequestError('Could not reach the Lexica API. Is it running?', 0, 'NETWORK_ERROR'),
      );

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
