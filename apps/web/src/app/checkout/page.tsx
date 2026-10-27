import type { Metadata } from "next";
import { RequireLogin } from "@/components/require-login";
import { Checkout } from "./checkout";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage() {
  return (
    <RequireLogin>
      <Checkout />
    </RequireLogin>
  );
}
