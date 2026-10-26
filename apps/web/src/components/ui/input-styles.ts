// The look of every text input, select and textarea, shared so all forms match.
// In its own plain module (not "use client"): a Server Component importing a value from a
// "use client" file gets a reference to client code, not the value, so it couldn't use it.
export const inputStyles =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none transition placeholder:text-faint focus:border-brand focus:ring-3 focus:ring-brand/15 aria-[invalid=true]:border-danger disabled:opacity-60";
