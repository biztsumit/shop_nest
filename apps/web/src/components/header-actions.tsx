"use client";

import { ThemeSwitch } from "./theme-switch";

// The right side of the header. (The account menu and cart button join it in later steps.)
export function HeaderActions() {
  return (
    <div className="flex items-center gap-2">
      <ThemeSwitch className="hidden sm:inline-flex" />
    </div>
  );
}
