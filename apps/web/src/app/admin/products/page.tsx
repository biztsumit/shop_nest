"use client";

import { adminProductSchema, formatPrice, pageSchema, type AdminProduct, type ProductStatus } from "@shop/shared";
import { ImageOff, Plus, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { inputStyles } from "@/components/ui/input-styles";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../admin-shell";
import { STATUS_TONE } from "../product-status";

const productsPage = pageSchema(adminProductSchema);

export default function AdminProductsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProductStatus | "">("");
  const query = new URLSearchParams({ limit: "25", ...(search && { search }), ...(status && { status }) });
  const { data, error } = useLoad(`/admin/products?${query}`, productsPage);
  const [more, setMore] = useState<{ rows: AdminProduct[]; cursor: string | null } | null>(null);

  // A new search or filter starts again from the first page
  const rows = [...(data?.data ?? []), ...(more?.rows ?? [])];
  const cursor = more ? more.cursor : (data?.nextCursor ?? null);
  const loadMore = async () => {
    const page = productsPage.parse(await api(`/admin/products?${query}&cursor=${cursor}`));
    setMore({ rows: [...(more?.rows ?? []), ...page.data], cursor: page.nextCursor });
  };

  return (
    <div>
      <AdminHeader title="Products">
        <Link href="/admin/products/new" className={buttonStyles()}><Plus className="size-4" aria-hidden /> New product</Link>
      </AdminHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setMore(null); }} placeholder="Name or slug" className={cn(inputStyles, "h-10 pl-9")} />
        </label>
        <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as ProductStatus | ""); setMore(null); }} className={cn(inputStyles, "h-10 w-auto")}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Product</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Price</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Stock</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Variants</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data === null && !error && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Loading…</td></tr>}
            {data && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No products match.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-subtle">
                <td className="px-4 py-2">
                  <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 font-medium hover:underline">
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-subtle">
                      {p.imageUrl ? <Image src={p.imageUrl} alt="" fill sizes="40px" className="object-cover" /> : <ImageOff className="m-auto mt-2.5 size-4 text-faint" aria-hidden />}
                    </span>
                    <span className="flex flex-col">
                      {p.name}
                      <span className="text-xs font-normal text-muted">{p.category?.name ?? "No category"}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-2"><Badge tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Badge></td>
                <td className="px-4 py-2 text-right tabular-nums">{formatPrice(p.price)}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums", p.stock === 0 && "font-medium text-danger")}>{p.stock}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.variantCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && <Button variant="secondary" className="mt-4" onClick={loadMore}>Load more</Button>}
    </div>
  );
}
