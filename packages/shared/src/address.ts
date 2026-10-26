import { z } from "zod";

// India's states and union territories: the only values the `state` field accepts, so orders
// never ship to "Maharastra" or "MH" or "maharashtra "
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
  "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

// "+91 98765-43210", "098765 43210", "9876543210" → "9876543210".
// Indian mobile numbers: 10 digits, starting with 6, 7, 8 or 9 (the courier calls this number).
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").replace(/^(\+91|0)(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "must be a 10-digit Indian mobile number"));

// PIN codes: 6 digits, never starting with 0
export const pincodeSchema = z.string().trim().regex(/^[1-9]\d{5}$/, "must be a 6-digit PIN code");

const text = (max: number) => z.string().trim().min(1, "is required").max(max, `must be at most ${max} characters`);

const addressFields = {
  fullName: text(100),
  phone: phoneSchema,
  line1: text(200),                                  // house / flat, street
  line2: z.string().trim().max(200).default(""),     // area, landmark (optional)
  city: text(100),
  state: z.enum(INDIAN_STATES, "choose a state from the list"),
  pincode: pincodeSchema,
};

export const createAddressSchema = z.object({ ...addressFields, isDefault: z.boolean().default(false) });

// PATCH: send only what changes
export const updateAddressSchema = z
  .object({
    fullName: addressFields.fullName,
    phone: addressFields.phone,
    line1: addressFields.line1,
    line2: z.string().trim().max(200),
    city: addressFields.city,
    state: addressFields.state,
    pincode: addressFields.pincode,
    isDefault: z.literal(true),   // you make another address the default, not "un-default" this one
  })
  .partial()
  .refine((a) => Object.keys(a).length > 0, "send at least one field to change");

export const addressSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  isDefault: z.boolean(),
});

// A user keeps a handful of addresses (home, office, parents'), not hundreds
export const MAX_ADDRESSES = 10;

export type CreateAddress = z.infer<typeof createAddressSchema>;
export type UpdateAddress = z.infer<typeof updateAddressSchema>;
export type Address = z.infer<typeof addressSchema>;
