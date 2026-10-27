"use client";

import { addressSchema, authResponseSchema, changePasswordSchema, type Address } from "@shop/shared";
import { BadgeCheck, MailWarning, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AddressForm, AddressLines } from "@/components/address-form";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PasswordField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, errorMessage } from "@/lib/client-api";

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Profile />
      <Addresses />
      <ChangePassword />
      <Sessions />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function Profile() {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await api("/auth/resend-verification", { method: "POST" });
      toast.show(`We've sent a new link to ${user.email}`);
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Profile">
      <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted">Name</dt>
        <dd className="font-medium">{user.name}</dd>
        <dt className="text-muted">Email</dt>
        <dd className="flex flex-wrap items-center gap-2 font-medium">
          {user.email}
          {user.emailVerified
            ? <Badge tone="success"><BadgeCheck className="size-3.5" aria-hidden /> Confirmed</Badge>
            : <Badge tone="warning"><MailWarning className="size-3.5" aria-hidden /> Not confirmed yet</Badge>}
        </dd>
      </dl>
      {!user.emailVerified && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning-soft p-4 text-sm">
          <span>Please click the link we emailed you, so we can reach you about your orders.</span>
          <Button size="sm" variant="secondary" loading={busy} onClick={resend}>Send a new link</Button>
        </div>
      )}
    </Section>
  );
}

function Addresses() {
  const toast = useToast();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const load = async () => setAddresses(addressSchema.array().parse(await api("/addresses")));

  useEffect(() => {
    let cancelled = false;
    void api("/addresses").then((body) => !cancelled && setAddresses(addressSchema.array().parse(body)));
    return () => {
      cancelled = true;
    };
  }, []);

  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      await load();
      toast.show(done);
    } catch (err) {
      toast.show(errorMessage(err), "error");
    }
  };

  return (
    <Section title="Addresses" description="Where we deliver. The default one is chosen first at checkout.">
      {addresses === null ? (
        <div className="h-24 animate-pulse rounded-lg bg-subtle" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className={editing === a.id ? "sm:col-span-2" : ""}>
              {editing === a.id ? (
                <div className="rounded-xl border border-line p-4">
                  <AddressForm address={a} onSaved={() => { setEditing(null); void load(); toast.show("Address saved"); }} onCancel={() => setEditing(null)} />
                </div>
              ) : (
                <div className="flex h-full flex-col gap-3 rounded-xl border border-line p-4">
                  <div className="flex items-start justify-between gap-2">
                    <AddressLines address={a} />
                    {a.isDefault && <Badge tone="brand">Default</Badge>}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(a.id)}><Pencil className="size-3.5" aria-hidden /> Edit</Button>
                    {!a.isDefault && (
                      <Button size="sm" variant="ghost" onClick={() => act(() => api(`/addresses/${a.id}`, { method: "PATCH", body: { isDefault: true } }), "Default address changed")}>
                        <Star className="size-3.5" aria-hidden /> Make default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => confirm("Delete this address?") && act(() => api(`/addresses/${a.id}`, { method: "DELETE" }), "Address deleted")}
                    >
                      <Trash2 className="size-3.5" aria-hidden /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === "new" ? (
        <div className="rounded-xl border border-line p-4">
          <AddressForm onSaved={() => { setEditing(null); void load(); toast.show("Address added"); }} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        <Button variant="secondary" className="w-fit" onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Add an address</Button>
      )}
    </Section>
  );
}

function ChangePassword() {
  const { signIn } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const checked = changePasswordSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!checked.success) {
      setFields(Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    setFields({});
    setError(null);
    try {
      // The API answers with a NEW login for this device; every other device is logged out
      signIn(authResponseSchema.parse(await api("/auth/change-password", { method: "POST", body: checked.data })));
      form.reset();
      toast.show("Password changed. Other devices have been logged out.");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Password" description="Changing it logs you out on every other device.">
      <form onSubmit={submit} className="grid max-w-xl gap-4 sm:grid-cols-2" noValidate>
        <PasswordField label="Current password" name="currentPassword" autoComplete="current-password" error={fields.currentPassword} />
        <PasswordField label="New password" name="newPassword" autoComplete="new-password" error={fields.newPassword} hint="At least 8 characters" />
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
        <Button type="submit" className="w-fit" loading={busy}>Change password</Button>
      </form>
    </Section>
  );
}

function Sessions() {
  const { logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const everywhere = async () => {
    if (!confirm("Log out on every device, including this one?")) return;
    setBusy(true);
    try {
      await api("/auth/logout-all", { method: "POST" });
      await logout();
      router.push("/login");
    } catch (err) {
      toast.show(errorMessage(err), "error");
      setBusy(false);
    }
  };

  return (
    <Section title="Devices" description="Lost a phone, or logged in on a shared computer? End every login at once.">
      <Button variant="danger" className="w-fit" loading={busy} onClick={everywhere}>Log out everywhere</Button>
    </Section>
  );
}
