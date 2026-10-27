"use client";

// Who's logged in, for every Client Component: const { user, login, logout } = useAuth()
//
// On page load it asks for a new access token with the refresh cookie. If that works, the
// visitor is still logged in from earlier; if not, they're a guest.
import { userSchema, type AuthResponse, type User } from "@shop/shared";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshSession, setAccessToken } from "@/lib/client-api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "guest"; user: null }
  | { status: "signed-in"; user: User };

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // A new session from elsewhere (changing the password returns one)
  signIn: (session: AuthResponse) => void;
  // Reads the user again (after verifying the email, say), so every component shows it
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  const signIn = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setState({ status: "signed-in", user: session.user });
  }, []);

  // Still logged in from an earlier visit?
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      setState(session ? { status: "signed-in", user: session.user } : { status: "guest", user: null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    signIn(await api<AuthResponse>("/auth/login", { method: "POST", body: { email, password } }));
  }, [signIn]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    signIn(await api<AuthResponse>("/auth/register", { method: "POST", body: { name, email, password } }));
  }, [signIn]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setAccessToken(null);
    setState({ status: "guest", user: null });
  }, []);

  const refreshUser = useCallback(async () => {
    setState({ status: "signed-in", user: userSchema.parse(await api("/auth/me")) });
  }, []);

  const value = useMemo(() => ({ ...state, login, register, logout, signIn, refreshUser }), [state, login, register, logout, signIn, refreshUser]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
