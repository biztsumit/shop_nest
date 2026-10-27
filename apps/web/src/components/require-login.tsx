"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { useAuth } from "./auth-provider";

// Pages that need a login: a guest is sent to /login, and comes back here afterwards.
// (The API checks the login on every request anyway: this is for a friendly flow, not security.)
//
// usePathname() reads the URL, a request-time value, so it must sit inside <Suspense>; the
// boundary here covers everything below too (the account nav reads the URL as well).
export function RequireLogin({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Placeholder />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (status === "guest") router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [status, path, router]);

  return status === "signed-in" ? children : <Placeholder />;
}

function Placeholder() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="h-9 w-48 animate-pulse rounded-lg bg-subtle" />
      <div className="h-40 animate-pulse rounded-xl bg-subtle" />
    </div>
  );
}
