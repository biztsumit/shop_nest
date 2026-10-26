import { SearchX } from "lucide-react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <EmptyState icon={SearchX} title="We couldn't find that page" text="It may have moved, or the product is no longer sold.">
      <Link href="/products" className={buttonStyles()}>Browse the shop</Link>
      <Link href="/" className={buttonStyles({ variant: "secondary" })}>Home</Link>
    </EmptyState>
  );
}
