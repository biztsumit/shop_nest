"use client";

import { newPasswordSchema } from "@shop/shared";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button, buttonStyles } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/client-api";

// Opened from the "Reset your password" email: /reset-password?token=...
export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    const checked = newPasswordSchema.safeParse(password);
    if (!checked.success) {
      setError(`Password ${checked.error.issues[0]?.message ?? "is invalid"}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthCard title="Password changed">
        <p className="flex items-start gap-3 text-muted">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          Your new password is set, and you&apos;ve been logged out everywhere for safety.
        </p>
        <Link href="/login" className={buttonStyles({ size: "lg" })}>Log in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" footer={<Link href="/forgot-password" className="font-medium text-brand-text hover:underline">Need a new link?</Link>}>
      {!token ? (
        <p className="text-danger">This link is incomplete. Please open it again from the email, or ask for a new one.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <PasswordField label="New password" name="password" autoComplete="new-password" hint="At least 8 characters" />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" loading={busy}>Save new password</Button>
        </form>
      )}
    </AuthCard>
  );
}
