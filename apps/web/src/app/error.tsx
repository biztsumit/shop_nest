"use client";

import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Shown instead of a page that crashed (the API was down, say). The rest of the site, header
// included, keeps working; "Try again" re-renders just this part.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState icon={CloudOff} title="Something went wrong on our side" text="Please try again in a moment.">
      <Button onClick={reset}>Try again</Button>
    </EmptyState>
  );
}
