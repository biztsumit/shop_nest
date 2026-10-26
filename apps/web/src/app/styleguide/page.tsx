import { Heart, PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Price } from "@/components/ui/price";
import { Stars } from "@/components/ui/stars";
import { StyleguideForm } from "./styleguide-form";

export const metadata: Metadata = { title: "Style guide" };

// Every building block of the shop on one page: a reference while building screens, and the
// quickest check that a change to globals.css looks right in BOTH themes (switch at the top).
const COLOURS = ["bg", "surface", "subtle", "line", "fg", "muted", "brand", "brand-soft", "success", "warning", "danger", "info"];

export default function StyleguidePage() {
  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Style guide</h1>
        <p className="text-muted">The shop&apos;s design tokens and components. Switch the theme in the header to check both modes.</p>
      </header>

      <Section title="Colour tokens">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {COLOURS.map((name) => (
            <div key={name} className="flex flex-col gap-1.5 text-xs">
              <span className="h-12 rounded-lg border border-line" style={{ background: `var(--${name})` }} />
              <code className="text-muted">{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-2">
          <p className="text-3xl font-semibold tracking-tight">Page title, 30px semibold</p>
          <p className="text-xl font-semibold">Section title, 20px</p>
          <p>Body text, 16px. Prices use tabular figures so columns line up: <span className="tabular-nums">₹1,299</span>.</p>
          <p className="text-sm text-muted">Secondary text, 14px, muted.</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" size="icon" aria-label="Save to wishlist"><Heart className="size-4" aria-hidden /></Button>
        </div>
      </Section>

      <Section title="Badges, prices, stars">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Neutral</Badge>
          <Badge tone="brand">New</Badge>
          <Badge tone="success">Paid</Badge>
          <Badge tone="warning">Awaiting payment</Badge>
          <Badge tone="danger">Out of stock</Badge>
          <Badge tone="info">Shipped</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-8">
          <Price amount={69900} compareAt={99900} />
          <Price amount={129900} size="lg" />
          <span className="flex items-center gap-2 text-sm"><Stars rating={4.3} /> 4.3 (12 reviews)</span>
        </div>
      </Section>

      <Section title="Cards and loading">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <p className="font-medium">A card</p>
            <p className="text-sm text-muted">Surface, hairline border, soft shadow.</p>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24" />
          </Card>
        </div>
      </Section>

      <Section title="Form fields">
        <StyleguideForm />
      </Section>

      <Section title="Empty state">
        <EmptyState icon={PackageOpen} title="No orders yet" text="When you place an order, it will show up here." />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}
