"use client";

import { forgotPasswordSchema } from "@shop/shared";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/client-api";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const checked = forgotPasswordSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!checked.success) {
      setError(`Email ${checked.error.issues[0]?.message ?? "is invalid"}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", { method: "POST", body: checked.data });
      setSentTo(checked.data.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    // The same answer whether or not there's an account: this page never reveals who's registered
    return (
      <AuthCard title="Check your inbox" footer={<Link href="/login" className="font-medium text-brand-text hover:underline">Back to log in</Link>}>
        <p className="flex items-start gap-3 text-muted">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <span>If <strong className="text-fg">{sentTo}</strong> has an account here, we&apos;ve sent it a link to choose a new password. The link works for an hour.</span>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={<Link href="/login" className="font-medium text-brand-text hover:underline">Back to log in</Link>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" loading={busy}>Send the link</Button>
      </form>
    </AuthCard>
  );
}
