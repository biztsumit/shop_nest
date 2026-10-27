"use client";

import { couponSchema, createCouponSchema, formatPrice, parseRupees, type Coupon } from "@shop/shared";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, errorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../admin-shell";

const coupons = couponSchema.array();

// What a coupon gives, in words: "10% off (up to ₹500), from ₹999"
const describe = (c: Coupon): string =>
  [
    c.type === "PERCENT" ? `${c.value}% off${c.maxDiscount ? ` (up to ${formatPrice(c.maxDiscount)})` : ""}` : `${formatPrice(c.value)} off`,
    c.minSubtotal > 0 && `on orders from ${formatPrice(c.minSubtotal)}`,
  ].filter(Boolean).join(", ");

export default function AdminCouponsPage() {
  const { data, error, reload } = useLoad("/admin/coupons", coupons);
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  const toggle = async (c: Coupon) => {
    try {
      await api(`/admin/coupons/${c.id}`, { method: "PATCH", body: { active: !c.active } });
      toast.show(c.active ? `${c.code} paused` : `${c.code} is live again`);
      reload();
    } catch (err) {
      toast.show(errorMessage(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Coupons">
        {!creating && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New coupon</Button>}
      </AdminHeader>
      {creating && <NewCoupon onDone={(created) => { setCreating(false); if (created) { toast.show("Coupon created"); reload(); } }} />}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Code</th>
              <th scope="col" className="px-4 py-3 font-medium">Gives</th>
              <th scope="col" className="px-4 py-3 font-medium">Valid</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Used</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No coupons yet.</td></tr>}
            {data?.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3"><span className="font-mono font-medium">{c.code}</span>{c.description && <span className="block text-xs text-muted">{c.description}</span>}</td>
                <td className="px-4 py-3">{describe(c)}</td>
                <td className="px-4 py-3 text-muted">{c.startsAt || c.endsAt ? `${c.startsAt ? formatDate(c.startsAt) : "now"} – ${c.endsAt ? formatDate(c.endsAt) : "no end"}` : "Always"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.usedCount}{c.usageLimit !== null && ` / ${c.usageLimit}`}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <Badge tone={c.active ? "success" : "neutral"}>{c.active ? "live" : "paused"}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.active ? "Pause" : "Resume"}</Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewCoupon({ onDone }: { onDone: (created: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const paise = (text: string | undefined) => (text ? parseRupees(text) : null);
    const body = {
      code: f.code,
      description: f.description,
      type: f.type,
      value: f.type === "PERCENT" ? Number(f.value) : (paise(f.value) ?? 0),
      minSubtotal: paise(f.minSubtotal) ?? 0,
      maxDiscount: paise(f.maxDiscount),
      usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
      perUserLimit: Number(f.perUserLimit || 1),
      // A date from the date picker means "from the start of that day, India time"
      startsAt: f.startsAt ? `${f.startsAt}T00:00:00+05:30` : null,
      endsAt: f.endsAt ? `${f.endsAt}T23:59:59+05:30` : null,
    };
    const checked = createCouponSchema.safeParse(body);
    if (!checked.success) {
      setFields(Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    setFields({});
    setError(null);
    try {
      await api("/admin/coupons", { method: "POST", body: checked.data });
      onDone(true);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fields);
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3" noValidate>
        <TextField label="Code" name="code" placeholder="MONSOON20" error={fields.code} className="uppercase" />
        <SelectField label="Type" name="type" defaultValue="PERCENT">
          <option value="PERCENT">Percent off</option>
          <option value="FIXED">Fixed ₹ off</option>
        </SelectField>
        <TextField label="Value (% or ₹)" name="value" inputMode="decimal" error={fields.value} />
        <TextField label="Description" name="description" placeholder="Monsoon sale" />
        <TextField label="Minimum order (₹)" name="minSubtotal" inputMode="decimal" />
        <TextField label="Most it can take off (₹)" name="maxDiscount" inputMode="decimal" hint="For percent coupons" />
        <TextField label="Starts" name="startsAt" type="date" />
        <TextField label="Ends" name="endsAt" type="date" error={fields.endsAt} />
        <TextField label="Total uses (empty = no limit)" name="usageLimit" type="number" min={1} />
        <TextField label="Uses per shopper" name="perUserLimit" type="number" min={1} defaultValue={1} />
        {error && <p role="alert" className="text-sm text-danger sm:col-span-3">{error}</p>}
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" loading={busy}>Create coupon</Button>
          <Button variant="ghost" onClick={() => onDone(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
