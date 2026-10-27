"use client";

import { adminReviewSchema, pageSchema } from "@shop/shared";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stars } from "@/components/ui/stars";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../admin-shell";

const reviewsPage = pageSchema(adminReviewSchema);

// Moderation: hiding a review takes it out of the shop and out of the product's stars
export default function AdminReviewsPage() {
  const { data, error, reload } = useLoad("/admin/reviews?limit=50", reviewsPage);
  const toast = useToast();

  const setHidden = async (id: string, hidden: boolean) => {
    try {
      await api(`/admin/reviews/${id}`, { method: "PATCH", body: { hidden } });
      toast.show(hidden ? "Review hidden" : "Review shown again");
      reload();
    } catch (err) {
      toast.show(errorMessage(err), "error");
    }
  };

  return (
    <div>
      <AdminHeader title="Reviews" />
      {error && <p role="alert" className="text-danger">{error}</p>}
      {data?.data.length === 0 && <p className="text-muted">No reviews yet.</p>}
      <ul className="flex flex-col gap-3">
        {data?.data.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <Stars rating={r.rating} />
                <span className="font-medium">{r.title}</span>
                {r.hidden && <Badge tone="danger">hidden</Badge>}
              </span>
              {r.body && <p className="text-sm text-muted">{r.body}</p>}
              <span className="text-xs text-muted">
                {r.authorName} on <Link href={`/products/${r.product.slug}`} className="text-brand-text hover:underline">{r.product.name}</Link> · {formatDate(r.createdAt)}
              </span>
            </div>
            <Button size="sm" variant={r.hidden ? "secondary" : "danger"} onClick={() => setHidden(r.id, !r.hidden)}>{r.hidden ? "Show" : "Hide"}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
