import { z } from 'zod';

export const AAIFTaskSchema = z.enum(['chat', 'completion', 'embedding']);
export type AAIFTask = z.infer<typeof AAIFTaskSchema>;

export const AAIFLatencySchema = z.enum(['low', 'balanced', 'high']);
export type AAIFLatency = z.infer<typeof AAIFLatencySchema>;

export const AAIFRequestSchema = z.object({
  input: z.string().min(1),
  task: AAIFTaskSchema.optional(),
  constraints: z
    .object({
      maxCost: z.number().min(0).optional(),
      latency: AAIFLatencySchema.optional()
    })
    .optional(),
  user: z
    .object({
      id: z.string().min(1),
      plan: z.string().min(1).optional()
    })
    .optional()
});

export type AAIFRequest = z.infer<typeof AAIFRequestSchema>;

export const AAIFResponseSchema = z.object({
  output: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  cost: z.number().min(0),
  routing: z.object({
    reason: z.string().min(1)
  })
});

export type AAIFResponse = z.infer<typeof AAIFResponseSchema>;

export function isAAIFRequest(value: unknown): value is AAIFRequest {
  return AAIFRequestSchema.safeParse(value).success;
}

export function isAAIFResponse(value: unknown): value is AAIFResponse {
  return AAIFResponseSchema.safeParse(value).success;
}
