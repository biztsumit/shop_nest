"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthCard, safeNext } from "@/components/auth-card";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { PasswordField, TextField } from "@/components/ui/field";
import { ApiRequestError, errorMessage } from "@/lib/client-api";

export function LoginForm() {
  const { status, login } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // Already logged in (or just did): carry on to where they were going
  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await login(String(form.get("email")), String(form.get("password")));
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fields);
      setBusy(false);
    }
  };

  const nextQuery = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to see your orders and check out."
      footer={<>New here? <Link href={`/register${nextQuery}`} className="font-medium text-brand-text hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Email" name="email" type="email" autoComplete="email" required error={fields.email} />
        <PasswordField label="Password" name="password" autoComplete="current-password" required error={fields.password} />
        <Link href="/forgot-password" className="-mt-2 w-fit text-sm text-brand-text hover:underline">Forgot your password?</Link>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" loading={busy}>Log in</Button>
      </form>
    </AuthCard>
  );
}
