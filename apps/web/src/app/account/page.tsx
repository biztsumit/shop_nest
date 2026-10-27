"use client";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui/card";

export default function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Card className="flex flex-col gap-1 p-5">
        <p className="font-medium">{user.name}</p>
        <p className="text-sm text-muted">{user.email}</p>
      </Card>
    </div>
  );
}
