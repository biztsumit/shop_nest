"use client";

import { stockAlertIdsSchema, type ProductVariant } from "@shop/shared";
import { Bell, BellOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/client-api";
import { useLoad } from "@/lib/use-load";

// Shown instead of "Add to cart" when the chosen variant is sold out: "email me when it's back".
// The API emails the shopper (once) when a background job sees stock again.
export function NotifyMe({ variant }: { variant: ProductVariant }) {
  const { status } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { data: waiting, setData } = useLoad(status === "signed-in" ? "/stock-alerts/ids" : null, stockAlertIdsSchema);
  const [busy, setBusy] = useState(false);
  const on = waiting?.includes(variant.id) ?? false;

  const toggle = async () => {
    if (status !== "signed-in") {
      // The email goes to an account: log in, then come back to this page
      router.push(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setBusy(true);
    try {
      await api(`/stock-alerts/${variant.id}`, { method: on ? "DELETE" : "PUT" });
      setData(on ? (waiting ?? []).filter((id) => id !== variant.id) : [...(waiting ?? []), variant.id]);
      toast.show(on ? "You won't be emailed about this one" : "We'll email you when it's back");
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Button size="lg" variant={on ? "secondary" : "primary"} loading={busy} onClick={toggle} aria-pressed={on}>
        {!busy && (on ? <BellOff className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />)}
        {on ? "Stop waiting" : "Email me when it's back"}
      </Button>
      {on && <p className="text-xs text-muted">We&apos;ll email you once, as soon as it&apos;s back in stock.</p>}
    </div>
  );
}
