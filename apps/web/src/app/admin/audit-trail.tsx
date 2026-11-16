"use client";

import { auditEventSchema, pageSchema, type AuditEntityType, type AuditEvent } from "@shop/shared";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

export const auditPage = pageSchema(auditEventSchema);

// Where an event's subject lives in the back office (null = no page of its own)
export const auditLink = (e: AuditEvent): string | null =>
  e.entityType === "product" ? `/admin/products/${e.entityId}`
    : e.entityType === "order" ? `/admin/orders/${e.entityId}`
      : e.entityType === "coupon" ? "/admin/coupons"
        : e.entityType === "review" ? "/admin/reviews"
          : e.entityType === "user" ? "/admin/users"
            : null;

// "Meera" for an admin, "The shop" for what happened by itself (an automatic refund, a script)
export const actorName = (e: AuditEvent): string => e.actor?.name ?? "The shop";

// One event as a list row: what happened, then who and when
export function AuditRow({ event, linked = false }: { event: AuditEvent; linked?: boolean }) {
  const href = linked ? auditLink(event) : null;
  return (
    <li className="flex flex-col gap-0.5 py-3">
      {href ? <Link href={href} className="text-sm hover:underline">{event.summary}</Link> : <span className="text-sm">{event.summary}</span>}
      <span className="text-xs text-muted">
        <span title={event.actor?.email}>{actorName(event)}</span> · <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
      </span>
    </li>
  );
}

// "History" on a product or order page: every recorded change to it, newest first
export function AuditTrail({ entityType, entityId }: { entityType: AuditEntityType; entityId: string }) {
  const query = new URLSearchParams({ entityType, entityId, limit: "20" });
  const { data, error } = useLoad(`/admin/audit?${query}`, auditPage);
  const [more, setMore] = useState<{ rows: AuditEvent[]; cursor: string | null } | null>(null);
  const rows = [...(data?.data ?? []), ...(more?.rows ?? [])];
  const cursor = more ? more.cursor : (data?.nextCursor ?? null);

  return (
    <Card className="flex flex-col gap-1 p-5">
      <h2 className="font-semibold">History</h2>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data && rows.length === 0 && <p className="text-sm text-muted">No changes recorded yet.</p>}
      <ul className="divide-y divide-line">
        {rows.map((e) => <AuditRow key={e.id} event={e} />)}
      </ul>
      {cursor && (
        <Button size="sm" variant="ghost" className="self-start" onClick={async () => {
          const page = auditPage.parse(await api(`/admin/audit?${query}&cursor=${cursor}`));
          setMore({ rows: [...(more?.rows ?? []), ...page.data], cursor: page.nextCursor });
        }}>Older changes</Button>
      )}
    </Card>
  );
}
