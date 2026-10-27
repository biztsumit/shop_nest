"use client";

import { adminProductDetailSchema, categorySchema, parseRupees, type AdminProductDetail, type AdminVariant, type ProductStatus } from "@shop/shared";
import { ExternalLink, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextareaField, TextField } from "@/components/ui/field";
import { inputStyles } from "@/components/ui/input-styles";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { formatOptions } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../../admin-shell";
import { STATUS_TONE } from "../../product-status";

const categories = categorySchema.array();

export function ProductEditor({ id }: { id: string }) {
  const { data: product, error, setData } = useLoad(`/admin/products/${id}`, adminProductDetailSchema);
  const { data: cats } = useLoad("/categories", categories);
  const toast = useToast();

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!product) return <div className="h-64 animate-pulse rounded-xl bg-subtle" aria-busy />;

  // Every change answers with the whole product, which replaces what's shown
  const save = async (path: string, method: "PATCH" | "POST" | "DELETE", body: unknown, done: string): Promise<boolean> => {
    try {
      setData(adminProductDetailSchema.parse(await api(path, { method, body })));
      toast.show(done);
      return true;
    } catch (err) {
      toast.show(errorMessage(err), "error");
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title={product.name}>
        <Badge tone={STATUS_TONE[product.status]}>{product.status.toLowerCase()}</Badge>
        {product.status === "ACTIVE" && (
          <Link href={`/products/${product.slug}`} className="flex items-center gap-1 text-sm text-brand-text hover:underline">View in shop <ExternalLink className="size-3.5" aria-hidden /></Link>
        )}
      </AdminHeader>

      <Details product={product} categories={cats ?? []} onSave={(body) => save(`/admin/products/${id}`, "PATCH", body, "Product saved")} />
      <Photos product={product} onSave={(images) => save(`/admin/products/${id}`, "PATCH", { images }, "Photos saved")} />
      <Variants product={product} save={save} />
      <p className="text-sm text-muted">Changes reach the shop&apos;s pages within a few minutes (they&apos;re cached for speed).</p>
    </div>
  );
}

function Details({ product, categories, onSave }: { product: AdminProductDetail; categories: Array<{ id: string; name: string; parentId: string | null }>; onSave: (body: object) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    await onSave({ name: f.name, slug: f.slug, description: f.description, status: f.status as ProductStatus, categoryId: f.categoryId || null });
    setBusy(false);
  };
  return (
    <Card className="p-5">
      <form key={product.updatedAt} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" name="name" defaultValue={product.name} />
        <TextField label="Slug" name="slug" defaultValue={product.slug} hint="Changing it breaks old links to this product" />
        <div className="sm:col-span-2"><TextareaField label="Description" name="description" defaultValue={product.description} /></div>
        <SelectField label="Category" name="categoryId" defaultValue={product.categoryId ?? ""}>
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>)}
        </SelectField>
        <SelectField label="Status" name="status" defaultValue={product.status} hint="Draft: hidden · Active: on sale · Archived: no longer sold">
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </SelectField>
        <Button type="submit" className="w-fit" loading={busy}>Save details</Button>
      </form>
    </Card>
  );
}

function Photos({ product, onSave }: { product: AdminProductDetail; onSave: (images: Array<{ url: string; alt: string }>) => Promise<boolean> }) {
  const [url, setUrl] = useState("");
  const change = (images: Array<{ url: string; alt: string }>) => onSave(images);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">Photos <span className="text-sm font-normal text-muted">(the first is the main one)</span></h2>
      {product.images.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {product.images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- any host an admin pastes; next/image only allows listed hosts */}
              <img src={img.url} alt={img.alt} className="size-24 rounded-lg border border-line object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => change(product.images.filter((_, j) => j !== i))} className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-surface shadow-card">
                <X className="size-3.5" aria-hidden />
              </button>
              {i > 0 && (
                <button type="button" onClick={() => change([img, ...product.images.filter((_, j) => j !== i)])} className="mt-1 block w-24 text-center text-xs text-brand-text hover:underline">Make main</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (url && (await change([...product.images, { url, alt: product.name }]))) setUrl("");
        }}
      >
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… photo URL" aria-label="Photo URL" className={cn(inputStyles, "h-10 max-w-md")} />
        <Button type="submit" variant="secondary">Add photo</Button>
      </form>
    </Card>
  );
}

function Variants({ product, save }: { product: AdminProductDetail; save: (path: string, method: "PATCH" | "POST" | "DELETE", body: unknown, done: string) => Promise<boolean> }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">Variants <span className="text-sm font-normal text-muted">(what is actually bought: each has its own price and stock)</span></h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted uppercase">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Options</th>
              <th scope="col" className="py-2 pr-3 font-medium">SKU</th>
              <th scope="col" className="py-2 pr-3 font-medium">Price ₹</th>
              <th scope="col" className="py-2 pr-3 font-medium">Was ₹</th>
              <th scope="col" className="py-2 pr-3 font-medium">Stock</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {product.variants.map((v) => <VariantRow key={`${v.id}-${product.updatedAt}`} variant={v} save={save} />)}
          </tbody>
        </table>
      </div>
      {adding ? (
        <NewVariant onCancel={() => setAdding(false)} onSave={async (body) => { if (await save(`/admin/products/${product.id}/variants`, "POST", body, "Variant added")) setAdding(false); }} />
      ) : (
        <Button variant="secondary" className="w-fit" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add a variant</Button>
      )}
    </Card>
  );
}

const rupees = (paise: number | null) => (paise === null ? "" : (paise / 100).toString());

function VariantRow({ variant, save }: { variant: AdminVariant; save: (path: string, method: "PATCH" | "DELETE", body: unknown, done: string) => Promise<boolean> }) {
  const [price, setPrice] = useState(rupees(variant.price));
  const [was, setWas] = useState(rupees(variant.compareAtPrice));
  const [stock, setStock] = useState(String(variant.stock));
  const [sku, setSku] = useState(variant.sku ?? "");
  const toast = useToast();
  const changed = price !== rupees(variant.price) || was !== rupees(variant.compareAtPrice) || stock !== String(variant.stock) || sku !== (variant.sku ?? "");
  const label = formatOptions(variant.options) || "Default";

  const submit = () => {
    const p = parseRupees(price);
    const w = was ? parseRupees(was) : null;
    if (p === null || (was && w === null) || !/^\d+$/.test(stock)) {
      toast.show("Prices look like 499 or 1,299.50, and stock is a whole number.", "error");
      return;
    }
    void save(`/admin/variants/${variant.id}`, "PATCH", { price: p, compareAtPrice: w, stock: Number(stock), sku: sku || null }, `${label} saved`);
  };

  const cell = cn(inputStyles, "h-9 w-24");
  return (
    <tr>
      <td className="py-2 pr-3 font-medium">{label}</td>
      <td className="py-2 pr-3"><input aria-label={`SKU of ${label}`} value={sku} onChange={(e) => setSku(e.target.value)} className={cn(cell, "w-32")} /></td>
      <td className="py-2 pr-3"><input aria-label={`Price of ${label}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={cell} /></td>
      <td className="py-2 pr-3"><input aria-label={`Was price of ${label}`} inputMode="decimal" value={was} onChange={(e) => setWas(e.target.value)} placeholder="—" className={cell} /></td>
      <td className="py-2 pr-3"><input aria-label={`Stock of ${label}`} inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} className={cn(cell, "w-20", Number(stock) === 0 && "text-danger")} /></td>
      <td className="flex gap-1 py-2">
        <Button size="sm" disabled={!changed} onClick={submit}>Save</Button>
        <Button size="sm" variant="ghost" aria-label={`Delete ${label}`} onClick={() => confirm(`Delete the ${label} variant?`) && void save(`/admin/variants/${variant.id}`, "DELETE", undefined, `${label} deleted`)}>
          <Trash2 className="size-4 text-danger" aria-hidden />
        </Button>
      </td>
    </tr>
  );
}

function NewVariant({ onSave, onCancel }: { onSave: (body: object) => Promise<void>; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        const options: Record<string, string> = {};
        // "size=XL, colour=Navy" → { size: "XL", colour: "Navy" }
        for (const part of (f.options ?? "").split(",")) {
          const [name, value] = part.split("=").map((s) => s.trim());
          if (name && value) options[name] = value;
        }
        const price = parseRupees(f.price ?? "");
        if (price === null) {
          setError("Enter a price like 499 or 1,299.50");
          return;
        }
        setError(null);
        await onSave({ options, price, stock: Number(f.stock || 0), sku: f.sku || null, compareAtPrice: f.was ? parseRupees(f.was) : null });
      }}
    >
      <div className="sm:col-span-3"><TextField label="Options" name="options" placeholder="size=XL, colour=Navy" hint="name=value pairs, separated by commas" /></div>
      <TextField label="Price (₹)" name="price" inputMode="decimal" />
      <TextField label="Was (₹, optional)" name="was" inputMode="decimal" />
      <TextField label="Stock" name="stock" type="number" min={0} defaultValue={0} />
      <TextField label="SKU (optional)" name="sku" />
      {error && <p role="alert" className="text-sm text-danger sm:col-span-3">{error}</p>}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit">Add variant</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

