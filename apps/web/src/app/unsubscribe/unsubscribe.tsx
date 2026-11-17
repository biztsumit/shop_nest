"use client";

import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { buttonStyles } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client-api";

// Opened from the "Turn them off" link in a cart reminder: /unsubscribe?token=...
// No login needed: the signed token is the permission, and it can only turn reminders OFF.
export function Unsubscribe() {
  const token = useSearchParams().get("token") ?? "";
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // Send it once, even if React runs this effect twice
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      void Promise.resolve().then(() => setResult({ ok: false, text: "This link is incomplete. Please open it again from the email." }));
      return;
    }
    api("/email-preferences/unsubscribe", { method: "POST", body: { token } })
      .then(() => setResult({ ok: true, text: "Done: we won't send you cart reminders any more. Emails about your orders still come." }))
      .catch((err: unknown) => setResult({ ok: false, text: errorMessage(err) }));
  }, [token]);

  return (
    <AuthCard title="Cart reminders">
      {!result ? (
        <p className="flex items-center gap-3 text-muted"><LoaderCircle className="size-5 animate-spin" aria-hidden /> One moment…</p>
      ) : (
        <p role="status" className="flex items-start gap-3">
          {result.ok ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <CircleX className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />}
          <span className={result.ok ? "" : "text-danger"}>{result.text}</span>
        </p>
      )}
      {result && (
        <Link href={result.ok ? "/products" : "/account"} className={buttonStyles({ size: "lg" })}>
          {result.ok ? "Continue shopping" : "Go to your account"}
        </Link>
      )}
    </AuthCard>
  );
}
