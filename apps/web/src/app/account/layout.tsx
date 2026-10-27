import { AccountNav } from "./account-nav";
import { RequireLogin } from "@/components/require-login";

// Everything under /account needs a login, and shares the side navigation
export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <RequireLogin>
      <div className="grid gap-8 md:grid-cols-[13rem_1fr]">
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </RequireLogin>
  );
}
