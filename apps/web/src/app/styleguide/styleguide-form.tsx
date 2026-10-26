"use client";

import { Button } from "@/components/ui/button";
import { PasswordField, SelectField, TextareaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

// The field components need the browser (the password eye, toasts), so this part is a Client Component
export function StyleguideForm() {
  const toast = useToast();
  return (
    <form className="grid max-w-2xl gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
      <TextField label="Full name" placeholder="Riya Sharma" hint="As it should appear on the parcel" />
      <TextField label="PIN code" defaultValue="0110" error="must be a 6-digit PIN code" />
      <SelectField label="State" defaultValue="Maharashtra">
        <option>Karnataka</option>
        <option>Maharashtra</option>
      </SelectField>
      <PasswordField label="Password" defaultValue="correct horse" />
      <div className="sm:col-span-2">
        <TextareaField label="Review" placeholder="What did you like?" />
      </div>
      <div className="flex gap-3 sm:col-span-2">
        <Button onClick={() => toast.show("Saved")}>Show a toast</Button>
        <Button variant="secondary" onClick={() => toast.show("Couldn't save", "error")}>Error toast</Button>
      </div>
    </form>
  );
}
