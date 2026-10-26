import { z } from "zod";

// Emails are compared lower-case: "Riya@Mail.com " and "riya@mail.com" are one account.
// The database refuses anything else (CHECK users_email_lowercase).
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("must be a valid email address").max(254, "is too long"));

// Length is what makes a password strong. The upper limit stops someone sending megabytes of
// "password" for the server to hash (a cheap way to keep it busy).
export const newPasswordSchema = z
  .string()
  .min(8, "must be at least 8 characters")
  .max(128, "must be at most 128 characters");

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "is required").max(100, "must be at most 100 characters"),
    email: emailSchema,
    password: newPasswordSchema,
  })
  .refine((r) => r.password.toLowerCase() !== r.email, {
    message: "must not be your email address",
    path: ["password"],
  });

// Logging in checks the password itself, not today's rules: an account made under older rules
// must still be able to log in
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "is required").max(128, "must be at most 128 characters"),
});

export const roleSchema = z.enum(["CUSTOMER", "ADMIN"]);

// What anyone (including the user) gets to see about an account: never the password hash
export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  emailVerified: z.boolean(),   // clicked the link in the verification email
});

// The answer to register and login
export const authResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),   // send as "Authorization: Bearer <token>"
  expiresIn: z.number().int(), // seconds until the token stops working
});

export type Register = z.infer<typeof registerSchema>;
export type Login = z.infer<typeof loginSchema>;
export type Role = z.infer<typeof roleSchema>;
export type User = z.infer<typeof userSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;

// ---------- Admin: managing users ----------

// A user as admins see them: also when they joined
export const adminUserSchema = userSchema.extend({ createdAt: z.string() });   // ISO date-time

export const changeRoleSchema = z.object({ role: roleSchema });

export type AdminUser = z.infer<typeof adminUserSchema>;
export type ChangeRole = z.infer<typeof changeRoleSchema>;

// ---------- Email links and passwords ----------

// The token from an email link (?token=...): 32 random bytes, base64url
const linkTokenSchema = z.string().trim().regex(/^[\w-]{20,100}$/, "this link is not valid");

export const verifyEmailSchema = z.object({ token: linkTokenSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({ token: linkTokenSchema, password: newPasswordSchema });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "is required").max(128),
    newPassword: newPasswordSchema,
  })
  .refine((c) => c.newPassword !== c.currentPassword, {
    message: "must be different from your current password",
    path: ["newPassword"],
  });

export type VerifyEmail = z.infer<typeof verifyEmailSchema>;
export type ForgotPassword = z.infer<typeof forgotPasswordSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
