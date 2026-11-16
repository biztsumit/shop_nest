import { z } from "zod";

// THE AUDIT LOG: who changed what in the back office, and when.

// What an event is about. Variant changes are filed under their product.
export const auditEntityTypeSchema = z.enum(["product", "category", "order", "coupon", "review", "user"]);

// Every kind of event, "<thing>.<what happened>"
export const AUDIT_ACTIONS = [
  "product.create",
  "product.update",
  "variant.create",
  "variant.update",
  "variant.delete",
  "category.create",
  "order.ship",
  "order.deliver",
  "order.cancel",
  "refund.create",
  "coupon.create",
  "coupon.update",
  "review.hide",
  "review.show",
  "user.role_change",
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);

// One changed field: what it was, what it became (null = not set, or didn't exist)
const changeSchema = z.object({ from: z.unknown(), to: z.unknown() });

export const auditEventSchema = z.object({
  id: z.uuid(),
  action: auditActionSchema,
  entityType: auditEntityTypeSchema,
  entityId: z.string(),
  summary: z.string(),
  changes: z.record(z.string(), changeSchema),
  // null = the shop itself (an automatic refund, a command run on the server)
  actor: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
  createdAt: z.string(),   // ISO date-time
});

// GET /api/admin/audit?entityType=product&entityId=<id>&actorId=<id>&limit=50&cursor=<last id>
export const auditListQuerySchema = z.object({
  entityType: auditEntityTypeSchema.optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export type AuditEntityType = z.infer<typeof auditEntityTypeSchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
