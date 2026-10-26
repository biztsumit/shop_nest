"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { inputStyles } from "./input-styles";

type FieldProps = { label: string; error?: string; hint?: string };

// The label, the control, and under it either the API's message for this field or a hint.
// The message is linked to the control (aria-describedby), so screen readers read it out.
function FieldShell({ id, label, error, hint, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">{label}</label>
      {children}
      {error ? <span id={`${id}-msg`} className="text-danger">{error}</span> : hint && <span id={`${id}-msg`} className="text-muted">{hint}</span>}
    </div>
  );
}

const describe = (id: string, error?: string, hint?: string) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error || hint ? `${id}-msg` : undefined,
});

export function TextField({ label, error, hint, className, ...input }: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <input {...input} {...describe(id, error, hint)} className={cn(inputStyles, "h-10", className)} />
    </FieldShell>
  );
}

export function SelectField({ label, error, hint, className, children, ...select }: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <select {...select} {...describe(id, error, hint)} className={cn(inputStyles, "h-10", className)}>{children}</select>
    </FieldShell>
  );
}

export function TextareaField({ label, error, hint, className, ...textarea }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <textarea {...textarea} {...describe(id, error, hint)} className={cn(inputStyles, "min-h-24 py-2", className)} />
    </FieldShell>
  );
}

// A password input with a 👁 button: on a phone keyboard, checking what you typed prevents
// a lot of failed logins
export function PasswordField({ label, error, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <span className="relative">
        <input {...input} {...describe(id, error, hint)} type={visible ? "text" : "password"} className={cn(inputStyles, "h-10 pr-11")} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label="Show password"
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-fg"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </span>
    </FieldShell>
  );
}
