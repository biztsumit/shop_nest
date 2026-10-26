"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

type Theme = "system" | "light" | "dark";
const KEY = "theme";
const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

// Runs in <head> BEFORE the page paints (see layout.tsx), so a dark-mode visitor never sees a
// white flash. It only sets data-theme; the CSS does the rest (globals.css).
export const themeScript = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

// The saved choice lives on <html data-theme>; this reads it in a way React can subscribe to
const listeners = new Set<() => void>();
const read = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const apply = (theme: Theme) => {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice still applies to this page
  }
  listeners.forEach((l) => l());
};

// Light · System · Dark, as a 3-way segmented control (radio buttons underneath)
export function ThemeSwitch({ className }: { className?: string }) {
  // On the server (and the first render) there's no saved choice yet: "system"
  const theme = useSyncExternalStore(subscribe, read, () => "system" as const);
  return (
    <div role="radiogroup" aria-label="Colour theme" className={cn("inline-flex rounded-lg border border-line bg-subtle p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => apply(value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:text-fg",
            theme === value && "bg-surface text-fg shadow-sm",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
