"use client";

import { pageSchema, reviewSchema, writeReviewSchema, type Page, type Review } from "@shop/shared";
import { Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button, buttonStyles } from "@/components/ui/button";
import { TextareaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { ReviewItem } from "./review-item";

// The shopper's own review: write it, edit it, delete it. One per shopper per product.
function MyReview({ slug, onMine }: { slug: string; onMine: (id: string | null) => void }) {
  const { status } = useAuth();
  const toast = useToast();
  const [mine, setMine] = useState<Review | null | undefined>(undefined);   // undefined = loading
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (status !== "signed-in") return;
    let cancelled = false;
    api(`/products/${slug}/reviews/mine`)
      .then((body) => !cancelled && setMine(reviewSchema.parse(body)))
      .catch((err: unknown) => !cancelled && setMine(err instanceof ApiRequestError && err.status === 404 ? null : undefined));
    return () => {
      cancelled = true;
    };
  }, [status, slug]);

  // Tell the list which review is the shopper's own, so it isn't shown twice
  useEffect(() => {
    if (mine !== undefined) onMine(mine?.id ?? null);
  }, [mine, onMine]);

  if (status === "guest") {
    return (
      <p className="text-sm text-muted">
        <Link href={`/login?next=/products/${slug}%23reviews`} className="font-medium text-brand-text hover:underline">Log in</Link> to write a review.
      </p>
    );
  }
  if (status === "loading" || mine === undefined) return null;

  if (editing || mine === null) {
    if (!editing) return <Button variant="secondary" className="w-fit" onClick={() => setEditing(true)}>Write a review</Button>;
    return (
      <ReviewForm
        slug={slug}
        current={mine}
        onSaved={(review) => { setMine(review); setEditing(false); toast.show("Thanks for your review!"); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const remove = async () => {
    if (!confirm("Delete your review?")) return;
    try {
      await api(`/products/${slug}/reviews/mine`, { method: "DELETE" });
      setMine(null);
      toast.show("Review deleted");
    } catch (err) {
      toast.show(errorMessage(err), "error");
    }
  };

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-brand/30 bg-brand-soft/40 px-4">
      <p className="pt-3 text-xs font-semibold tracking-wider text-brand-text uppercase">Your review</p>
      <ul><ReviewItem review={mine} /></ul>
      <div className="flex gap-2 pb-3">
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={remove}>Delete</Button>
      </div>
    </div>
  );
}

function ReviewForm({ slug, current, onSaved, onCancel }: { slug: string; current: Review | null; onSaved: (review: Review) => void; onCancel: () => void }) {
  const [rating, setRating] = useState(current?.rating ?? 0);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const checked = writeReviewSchema.safeParse({ ...form, rating });
    if (!checked.success) {
      setFields(Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    setFields({});
    setError(null);
    try {
      onSaved(reviewSchema.parse(await api(`/products/${slug}/reviews/mine`, { method: "PUT", body: checked.data })));
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-line p-4" noValidate>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Your rating</legend>
        {/* Five radio buttons drawn as stars: keyboard arrows and screen readers work as usual */}
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" />
              <span className="sr-only">{n} {n === 1 ? "star" : "stars"}</span>
              <Star aria-hidden className={cn("size-7 rounded peer-focus-visible:outline-2 peer-focus-visible:outline-brand", n <= rating ? "fill-star text-star" : "text-line-strong")} />
            </label>
          ))}
        </div>
        {fields.rating && <span className="text-sm text-danger">{fields.rating}</span>}
      </fieldset>
      <TextField label="Title" name="title" defaultValue={current?.title} maxLength={120} error={fields.title} placeholder="Soft, and it lasts" />
      <TextareaField label="Your review (optional)" name="body" defaultValue={current?.body} maxLength={4000} error={fields.body} placeholder="How does it fit? How did it hold up?" />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>Post review</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// The list under the summary: the shopper's own review on top (editable), then everyone
// else's. The first page comes from the server; the shopper's own is left out of it, so it
// isn't shown twice.
export function ReviewsList({ slug, firstPage }: { slug: string; firstPage: Page<Review> }) {
  const [mineId, setMineId] = useState<string | null>(null);
  const others = firstPage.data.filter((r) => r.id !== mineId);
  return (
    <>
      <MyReview slug={slug} onMine={setMineId} />
      {others.length > 0 && <ul className="flex flex-col divide-y divide-line">{others.map((r) => <ReviewItem key={r.id} review={r} />)}</ul>}
      {firstPage.nextCursor && <MoreReviews slug={slug} cursor={firstPage.nextCursor} hide={mineId} />}
    </>
  );
}

// "Show more reviews": the next pages, fetched in the browser
function MoreReviews({ slug, cursor, hide }: { slug: string; cursor: string; hide: string | null }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const page = pageSchema(reviewSchema).parse(await api(`/products/${slug}/reviews?limit=10&cursor=${next}`));
    setReviews((all) => [...all, ...page.data]);
    setNext(page.nextCursor);
    setBusy(false);
  };

  return (
    <>
      {reviews.length > 0 && <ul className="flex flex-col divide-y divide-line border-t border-line">{reviews.filter((r) => r.id !== hide).map((r) => <ReviewItem key={r.id} review={r} />)}</ul>}
      {next && <button type="button" onClick={load} disabled={busy} className={buttonStyles({ variant: "secondary", className: "w-fit" })}>{busy ? "Loading…" : "Show more reviews"}</button>}
    </>
  );
}
