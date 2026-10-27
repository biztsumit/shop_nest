import type { Review } from "@shop/shared";
import { BadgeCheck } from "lucide-react";
import { Stars } from "@/components/ui/stars";
import { formatDate } from "@/lib/format";

// One review. No "use client": the server section and the client parts both render it.
export function ReviewItem({ review }: { review: Review }) {
  return (
    <li className="flex flex-col gap-2 py-5 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars rating={review.rating} />
        <h3 className="font-medium">{review.title}</h3>
      </div>
      {review.body && <p className="leading-relaxed whitespace-pre-line text-muted">{review.body}</p>}
      <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
        <span>{review.authorName}</span>
        <span>{formatDate(review.createdAt)}</span>
        {review.verifiedPurchase && <span className="flex items-center gap-1 text-success"><BadgeCheck className="size-4" aria-hidden /> Verified purchase</span>}
      </p>
    </li>
  );
}
