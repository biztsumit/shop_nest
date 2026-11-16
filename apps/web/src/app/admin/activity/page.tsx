"use client";

import type { AuditEntityType, AuditEvent } from "@shop/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../admin-shell";
import { auditPage, AuditRow } from "../audit-trail";

const KINDS: Array<[AuditEntityType | "", string]> = [
  ["", "Everything"], ["product", "Products"], ["order", "Orders"], ["coupon", "Coupons"], ["review", "Reviews"], ["user", "Users"], ["category", "Categories"],
];

// The audit log: every change made in the back office, newest first. Read-only, here and in
// the database (rows can't be edited or deleted).
export default function AdminActivityPage() {
  const [kind, setKind] = useState<AuditEntityType | "">("");
  const query = new URLSearchParams({ limit: "50", ...(kind && { entityType: kind }) });
  const { data, error } = useLoad(`/admin/audit?${query}`, auditPage);
  const [more, setMore] = useState<{ rows: AuditEvent[]; cursor: string | null } | null>(null);
  const rows = [...(data?.data ?? []), ...(more?.rows ?? [])];
  const cursor = more ? more.cursor : (data?.nextCursor ?? null);

  return (
    <div>
      <AdminHeader title="Activity" />
      <div role="tablist" aria-label="What changed" className="mb-4 flex flex-wrap gap-1">
        {KINDS.map(([value, label]) => (
          <button key={label} type="button" role="tab" aria-selected={kind === value} onClick={() => { setKind(value); setMore(null); }}
            className={cn("rounded-full px-3 py-1.5 text-sm", kind === value ? "bg-brand text-brand-fg" : "bg-subtle text-muted hover:text-fg")}>
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="rounded-xl border border-line bg-surface px-4">
        {data === null && !error && <p className="py-8 text-center text-muted">Loading…</p>}
        {data && rows.length === 0 && <p className="py-8 text-center text-muted">Nothing has changed here yet.</p>}
        <ul className="divide-y divide-line">
          {rows.map((e) => <AuditRow key={e.id} event={e} linked />)}
        </ul>
      </div>
      {cursor && (
        <Button variant="secondary" className="mt-4" onClick={async () => {
          const page = auditPage.parse(await api(`/admin/audit?${query}&cursor=${cursor}`));
          setMore({ rows: [...(more?.rows ?? []), ...page.data], cursor: page.nextCursor });
        }}>Load more</Button>
      )}
    </div>
  );
}
