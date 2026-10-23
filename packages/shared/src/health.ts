import { z } from "zod";

// GET /api/health
// A zod schema is a description of data that can CHECK data at runtime (schema.parse(value))
// and also gives TypeScript the type (z.infer). One definition, both jobs.
export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["up", "down"]),
  uptimeSeconds: z.number().int().nonnegative(),
  version: z.string(),
});

export type Health = z.infer<typeof healthSchema>;
