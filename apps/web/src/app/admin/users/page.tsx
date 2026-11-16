"use client";

import { adminUserSchema, pageSchema, type AdminUser, type Role } from "@shop/shared";
import { Search } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputStyles } from "@/components/ui/input-styles";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../admin-shell";

const usersPage = pageSchema(adminUserSchema);
const ROLES: Array<[Role | "", string]> = [["", "All"], ["ADMIN", "Admins"], ["CUSTOMER", "Customers"]];

// Who has an account, and who may run the shop. (The API refuses to remove the last admin.)
export default function AdminUsersPage() {
  const { user: me, refreshUser } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState<Role | "">("");
  const [search, setSearch] = useState("");
  const query = new URLSearchParams({ limit: "50", ...(role && { role }), ...(search && { search }) });
  const { data, error, reload } = useLoad(`/admin/users?${query}`, usersPage);
  const [more, setMore] = useState<{ rows: AdminUser[]; cursor: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = [...(data?.data ?? []), ...(more?.rows ?? [])];
  const cursor = more ? more.cursor : (data?.nextCursor ?? null);

  const changeRole = async (u: AdminUser) => {
    const promote = u.role !== "ADMIN";
    const self = u.id === me?.id;
    const question = promote
      ? `Make ${u.name} an admin? They'll be able to change products, orders, refunds and other admins.`
      : self
        ? "Remove your own admin access? You'll leave the back office straight away."
        : `Remove admin access from ${u.name}?`;
    if (!confirm(question)) return;

    setBusy(u.id);
    try {
      await api(`/admin/users/${u.id}/role`, { method: "PATCH", body: { role: promote ? "ADMIN" : "CUSTOMER" } });
      toast.show(promote ? `${u.name} is now an admin` : `${u.name} is no longer an admin`);
      // Demoted yourself: re-read your account, and the admin area closes
      if (self) return void (await refreshUser());
      setMore(null);
      reload();
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <AdminHeader title="Users" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Role" className="flex flex-wrap gap-1">
          {ROLES.map(([value, label]) => (
            <button key={label} type="button" role="tab" aria-selected={role === value} onClick={() => { setRole(value); setMore(null); }}
              className={cn("rounded-full px-3 py-1.5 text-sm", role === value ? "bg-brand text-brand-fg" : "bg-subtle text-muted hover:text-fg")}>
              {label}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full max-w-xs">
          <span className="sr-only">Search users</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setMore(null); }} placeholder="Name or email" className={cn(inputStyles, "h-10 pl-9")} />
        </label>
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">User</th>
              <th scope="col" className="px-4 py-3 font-medium">Joined</th>
              <th scope="col" className="px-4 py-3 font-medium">Email</th>
              <th scope="col" className="px-4 py-3 font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data === null && !error && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">Loading…</td></tr>}
            {data && rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No users here.</td></tr>}
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <span className="font-medium">{u.name}</span>{u.id === me?.id && <span className="text-muted"> (you)</span>}
                  <span className="block text-xs text-muted">{u.email}</span>
                </td>
                <td className="px-4 py-3 text-muted">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-3"><Badge tone={u.emailVerified ? "success" : "warning"}>{u.emailVerified ? "verified" : "not verified"}</Badge></td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <Badge tone={u.role === "ADMIN" ? "brand" : "neutral"}>{u.role === "ADMIN" ? "admin" : "customer"}</Badge>
                    <Button size="sm" variant="ghost" loading={busy === u.id} onClick={() => changeRole(u)}>
                      {u.role === "ADMIN" ? "Remove admin" : "Make admin"}
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <Button variant="secondary" className="mt-4" onClick={async () => {
          const page = usersPage.parse(await api(`/admin/users?${query}&cursor=${cursor}`));
          setMore({ rows: [...(more?.rows ?? []), ...page.data], cursor: page.nextCursor });
        }}>Load more</Button>
      )}
    </div>
  );
}
