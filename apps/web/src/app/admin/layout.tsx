import type { Metadata } from "next";
import { RequireLogin } from "@/components/require-login";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false } };

// Admins only. (The API checks the role on every request: this only decides what to show.)
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <RequireLogin>
      <AdminShell>{children}</AdminShell>
    </RequireLogin>
  );
}
