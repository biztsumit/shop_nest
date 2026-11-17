import { z } from "zod";

// Which optional emails a shopper gets. (Emails about their own orders and account always go.)
//   GET/PATCH /api/account/preferences                     logged in, from the account page
//   POST      /api/email-preferences/unsubscribe { token } the one-click link in a reminder
export const emailPreferencesSchema = z.object({
  cartReminders: z.boolean(),   // "You left something in your cart"
});

export const unsubscribeSchema = z.object({ token: z.string().min(1, "is required").max(2000) });

export type EmailPreferences = z.infer<typeof emailPreferencesSchema>;
export type Unsubscribe = z.infer<typeof unsubscribeSchema>;
