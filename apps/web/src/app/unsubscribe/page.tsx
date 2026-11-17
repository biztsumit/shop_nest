import type { Metadata } from "next";
import { Suspense } from "react";
import { Unsubscribe } from "./unsubscribe";

export const metadata: Metadata = { title: "Turn off cart reminders", robots: { index: false } };

export default function UnsubscribePage() {
  return (
    <Suspense>
      <Unsubscribe />
    </Suspense>
  );
}
