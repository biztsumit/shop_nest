"use client";

import { addressSchema, createAddressSchema, INDIAN_STATES, type Address } from "@shop/shared";
import { useState, type FormEvent } from "react";
import { api, ApiRequestError, errorMessage } from "@/lib/client-api";
import { Button } from "./ui/button";
import { SelectField, TextField } from "./ui/field";

// Adding or editing a delivery address. Checked with the shared schema first (instant
// messages), then saved through the API (which checks the same rules again).
export function AddressForm({ address, onSaved, onCancel }: { address?: Address; onSaved: (address: Address) => void; onCancel?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const checked = createAddressSchema.safeParse({ ...form, isDefault: form.isDefault === "on" });
    if (!checked.success) {
      setFields(Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { isDefault, ...rest } = checked.data;
      const saved = address
        ? await api(`/addresses/${address.id}`, { method: "PATCH", body: { ...rest, ...(isDefault ? { isDefault: true } : {}) } })
        : await api("/addresses", { method: "POST", body: checked.data });
      onSaved(addressSchema.parse(saved));
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <TextField label="Full name" name="fullName" autoComplete="name" defaultValue={address?.fullName} error={fields.fullName} />
      <TextField label="Mobile number" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={address?.phone} error={fields.phone} hint="The courier will call this number" />
      <div className="sm:col-span-2">
        <TextField label="Flat, house, building" name="line1" autoComplete="address-line1" defaultValue={address?.line1} error={fields.line1} />
      </div>
      <div className="sm:col-span-2">
        <TextField label="Area, street, landmark (optional)" name="line2" autoComplete="address-line2" defaultValue={address?.line2} error={fields.line2} />
      </div>
      <TextField label="City" name="city" autoComplete="address-level2" defaultValue={address?.city} error={fields.city} />
      <TextField label="PIN code" name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} defaultValue={address?.pincode} error={fields.pincode} />
      <SelectField label="State" name="state" autoComplete="address-level1" defaultValue={address?.state ?? ""} error={fields.state}>
        <option value="" disabled>Choose a state</option>
        {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
      </SelectField>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="isDefault" defaultChecked={address?.isDefault} className="size-4 accent-brand" /> Use as my default address
      </label>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" loading={busy}>{address ? "Save address" : "Add address"}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

// "Riya Sharma, 12 MG Road, Pune 411001, Maharashtra · 9876543210"
export function AddressLines({ address }: { address: Omit<Address, "id" | "isDefault"> }) {
  return (
    <span className="flex flex-col text-sm">
      <span className="font-medium">{address.fullName}</span>
      <span className="text-muted">{address.line1}{address.line2 && `, ${address.line2}`}</span>
      <span className="text-muted">{address.city} {address.pincode}, {address.state}</span>
      <span className="text-muted">Phone {address.phone}</span>
    </span>
  );
}
