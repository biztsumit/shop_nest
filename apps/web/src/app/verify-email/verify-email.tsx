"use client";

import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { useAuth } from "@/components/auth-provider";
import { buttonStyles } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client-api";

// Opened from the "Confirm your email" email: /verify-email?token=...
export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const { status, refreshUser } = useAuth();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // The link works ONCE: make sure it's sent once, even if React runs this effect twice
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      void Promise.resolve().then(() => setResult({ ok: false, text: "This link is incomplete. Please open it again from the email." }));
      return;
    }
    api("/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setResult({ ok: true, text: "Thanks! Your email address is confirmed." }))
      .catch((err: unknown) => setResult({ ok: false, text: errorMessage(err) }));
  }, [token]);

  // Logged in here too? Update the account page's "Not confirmed" badge
  useEffect(() => {
    if (result?.ok && status === "signed-in") void refreshUser();
  }, [result, status, refreshUser]);

  return (
    <AuthCard title="Confirming your email">
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
          {result.ok ? "Continue shopping" : "Ask for a new link"}
        </Link>
      )}
    </AuthCard>
  );
}
