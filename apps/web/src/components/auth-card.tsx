import type { ReactNode } from "react";
import { Card } from "./ui/card";

// The narrow centred card that login, sign-up and password pages share
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6">
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted">{subtitle}</p>}
        </div>
        {children}
      </Card>
      {footer && <p className="text-center text-sm text-muted">{footer}</p>}
    </div>
  );
}

// Where to go after logging in: only paths on THIS site ("/checkout"), never "https://evil.example"
// or "//evil.example" (an "open redirect" would let phishing links bounce through our login)
export const safeNext = (next: string | null): string => (next && /^\/(?!\/)/.test(next) ? next : "/");
