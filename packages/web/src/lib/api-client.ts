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

/**
 * Fetches a JSON endpoint of the Lexica API and validates the response with a
 * shared Zod schema, so the UI never works with data of an unexpected shape.
 */
export async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(parsed.data.error.message, res.status, parsed.data.error.code)
      : new ApiRequestError(`Request failed with status ${res.status}`, res.status, 'HTTP_ERROR');
  }

  return schema.parse(body);
}
