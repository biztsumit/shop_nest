import { Suspense } from "react";
import { ApiStatus } from "./api-status";

// Step 1: a placeholder home page that proves the three parts of the monorepo work together.
// The storefront replaces it in the next steps.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Shop</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Next.js storefront + NestJS API + a shared package, in one repository.
        </p>
      </div>
      {/* The status is fetched for each visit (request-time data), so it streams in inside
          <Suspense>; the rest of the page is prerendered */}
      <Suspense fallback={<div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />}>
        <ApiStatus />
      </Suspense>
    </main>
  );
}
