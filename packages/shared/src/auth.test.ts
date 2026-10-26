import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "./auth.js";

describe("account input rules", () => {
  it("normalises the email: trimmed and lower-case", () => {
    const r = registerSchema.parse({ name: " Riya ", email: "  Riya@Mail.COM ", password: "correct horse" });
    expect(r).toEqual({ name: "Riya", email: "riya@mail.com", password: "correct horse" });
  });

  it("passwords: at least 8 characters, at most 128, and not the email address", () => {
    const issues = (password: string) =>
      registerSchema.safeParse({ name: "R", email: "riya@mail.com", password }).error?.issues.map((i) => i.message);
    expect(issues("short")).toEqual(["must be at least 8 characters"]);
    expect(issues("x".repeat(129))).toEqual(["must be at most 128 characters"]);
    expect(issues("Riya@Mail.com")).toEqual(["must not be your email address"]);
    expect(issues("a long enough passphrase")).toBeUndefined();
  });

  it("login does not apply the new-password rules (old accounts must still log in)", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("email-link tokens: the shape of a real one passes, anything else doesn't", () => {
    const token = "Xy9_" + "a".repeat(39);   // 43 characters of base64url, like the API makes
    expect(resetPasswordSchema.safeParse({ token, password: "a new long password" }).success).toBe(true);
    for (const bad of ["short", "has spaces in it, which is wrong", "<script>alert(1)</script>xxxxxxxxxx"]) {
      expect(resetPasswordSchema.safeParse({ token: bad, password: "a new long password" }).success).toBe(false);
    }
  });

  it("a new password must differ from the current one", () => {
    const r = changePasswordSchema.safeParse({ currentPassword: "same password", newPassword: "same password" });
    expect(r.error?.issues[0]?.path).toEqual(["newPassword"]);
  });
});
