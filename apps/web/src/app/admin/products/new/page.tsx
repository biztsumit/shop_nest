"use client";

import { adminProductDetailSchema, categorySchema, createProductSchema, parseRupees, slugify } from "@shop/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextareaField, TextField } from "@/components/ui/field";
import { api, ApiRequestError, errorMessage } from "@/lib/client-api";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../../admin-shell";

const categories = categorySchema.array();

// A new product with its first variant. More variants, and more photos, are added in the
// editor afterwards. New products start as drafts: nothing appears in the shop until it's ready.
export default function NewProductPage() {
  const router = useRouter();
  const { data: cats } = useLoad("/categories", categories);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const price = parseRupees(form.price ?? "");
    const compareAt = form.compareAtPrice ? parseRupees(form.compareAtPrice) : null;
    const body = {
      name,
      slug,
      description: form.description,
      categoryId: form.categoryId || null,
      variants: [{
        options: form.optionName && form.optionValue ? { [form.optionName]: form.optionValue } : {},
        sku: form.sku || null,
        price: price ?? -1,
        compareAtPrice: compareAt,
        stock: Number(form.stock || 0),
      }],
      images: form.imageUrl ? [{ url: form.imageUrl, alt: form.imageAlt ?? "" }] : [],
    };
    // Field names in the schema's messages ("variants.0.price") → the form's names ("price")
    const checked = createProductSchema.safeParse(body);
    if (!checked.success || price === null) {
      const issues = checked.success ? [] : checked.error.issues;
      setFields({
        ...Object.fromEntries(issues.map((i) => [String(i.path.at(-1)), i.message])),
        ...(price === null ? { price: "enter a price like 499 or 1,299.50" } : {}),
      });
      return;
    }
    setBusy(true);
    setFields({});
    setError(null);
    try {
      const created = adminProductDetailSchema.parse(await api("/admin/products", { method: "POST", body: checked.data }));
      router.push(`/admin/products/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.split(".").at(-1)!, v])));
      setBusy(false);
    }
  };

  return (
    <div>
      <AdminHeader title="New product" />
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" noValidate>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <TextField label="Name" value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} error={fields.name} />
          <TextField label="Slug (the web address)" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} error={fields.slug} hint={slug ? `/products/${slug}` : undefined} />
          <div className="sm:col-span-2"><TextareaField label="Description" name="description" error={fields.description} /></div>
          <SelectField label="Category" name="categoryId" defaultValue="">
            <option value="">No category</option>
            {cats?.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>)}
          </SelectField>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">First variant</h2>
          <TextField label="Price (₹)" name="price" inputMode="decimal" placeholder="1,299" error={fields.price} />
          <TextField label="Was (₹, optional)" name="compareAtPrice" inputMode="decimal" error={fields.compareAtPrice} />
          <TextField label="Stock" name="stock" type="number" min={0} defaultValue={0} error={fields.stock} />
          <TextField label="Option name (optional)" name="optionName" placeholder="size" />
          <TextField label="Option value" name="optionValue" placeholder="M" />
          <TextField label="SKU (optional)" name="sku" error={fields.sku} />
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Main photo (optional)</h2>
          <TextField label="Photo URL" name="imageUrl" type="url" placeholder="https://images.unsplash.com/…" error={fields.url} />
          <TextField label="What it shows (for screen readers)" name="imageAlt" />
        </Card>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" loading={busy}>Create as draft</Button>
          <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
