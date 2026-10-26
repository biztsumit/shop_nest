import type { Page, RatingSummary, Review } from "@shop/shared";
import { BadgeCheck } from "lucide-react";
import { Stars } from "@/components/ui/stars";
import { formatDate, plural } from "@/lib/format";

// The stars summary (with a bar per rating) and the newest reviews
export function ReviewsSection({ rating, firstPage }: { slug: string; rating: RatingSummary; firstPage: Page<Review> }) {
  return (
    <section id="reviews" className="grid scroll-mt-24 gap-8 border-t border-line pt-10 md:grid-cols-[18rem_1fr]">
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Reviews</h2>
        {rating.count > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-semibold tabular-nums">{rating.average?.toFixed(1)}</span>
              <div className="flex flex-col gap-1">
                <Stars rating={rating.average ?? 0} size="md" />
                <span className="text-sm text-muted">{plural(rating.count, "review")}</span>
              </div>
            </div>
            {/* A bar per star rating; the number beside it says the same, for everyone */}
            <ul className="flex flex-col gap-1.5 text-sm">
              {rating.distribution.map((count, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-6 text-muted tabular-nums">{5 - i}★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
                    <span className="block h-full rounded-full bg-star" style={{ width: `${(count / rating.count) * 100}%` }} />
                  </span>
                  <span className="w-6 text-right text-muted tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted">No reviews yet. Bought it? Be the first to say what you think.</p>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {firstPage.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {firstPage.data.map((review) => <ReviewItem key={review.id} review={review} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

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
