"use client";

import { registerSchema } from "@shop/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthCard, safeNext } from "@/components/auth-card";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { PasswordField, TextField } from "@/components/ui/field";
import { ApiRequestError, errorMessage } from "@/lib/client-api";

export function RegisterForm() {
  const { status, register } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    // The SAME rules the API checks (shared schema): mistakes show at once, without a round trip
    const checked = registerSchema.safeParse(form);
    if (!checked.success) {
      setFields(Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await register(checked.data.name, checked.data.email, checked.data.password);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fields);
      setBusy(false);
    }
  };

  const nextQuery = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthCard
      title="Create your account"
      subtitle="It takes a minute. We'll email you a link to confirm your address."
      footer={<>Already have an account? <Link href={`/login${nextQuery}`} className="font-medium text-brand-text hover:underline">Log in</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Full name" name="name" autoComplete="name" required error={fields.name} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required error={fields.email} />
        <PasswordField label="Password" name="password" autoComplete="new-password" required error={fields.password} hint="At least 8 characters. A short sentence works well." />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" loading={busy}>Create account</Button>
      </form>
    </AuthCard>
  );
}
