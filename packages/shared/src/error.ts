import { z } from 'zod';

/** Every API error uses this one JSON shape, so the web app can handle them uniformly. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
