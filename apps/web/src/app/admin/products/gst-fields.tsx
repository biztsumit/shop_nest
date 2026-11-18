import { GST_RATES } from "@shop/shared";
import { SelectField, TextField } from "@/components/ui/field";

// The product's HSN code and GST rate, printed on every invoice for it. Prices include GST, so
// changing the rate doesn't change the price: it changes how much of it is tax. Orders already
// placed keep the rate they were placed at.
export function GstFields({ hsnCode = "", gstRate = 18, errors = {} }: { hsnCode?: string; gstRate?: number; errors?: Record<string, string | undefined> }) {
  return (
    <>
      <TextField label="HSN code" name="hsnCode" defaultValue={hsnCode} inputMode="numeric" maxLength={8} placeholder="6109" error={errors.hsnCode}
        hint="4, 6 or 8 digits, for GST invoices (6109 = T-shirts)" />
      <SelectField label="GST rate" name="gstRate" defaultValue={String(gstRate)} error={errors.gstRate} hint="Included in the price">
        {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
      </SelectField>
    </>
  );
}
