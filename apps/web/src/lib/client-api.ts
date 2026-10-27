// Calling the API from the BROWSER (Client Components), as the logged-in user.
//
// The access token lives only in this module's memory: not in localStorage, where any script on
// the page (an XSS bug, a bad npm package) could read it. A reload forgets it, and the httpOnly
// refresh cookie (which scripts can't read) gets a new one.
import { authResponseSchema, problemSchema, type AuthResponse } from "@shop/shared";

let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

// An error answer from the API (RFC 9457 Problem Details): `message` is the API's `detail`,
// `fields` maps each invalid field to its message ({ "pincode": "must be a 6-digit PIN code" })
export class ApiRequestError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(status: number, body: unknown) {
    const problem = problemSchema.safeParse(body);
    super(problem.success ? problem.data.detail : `Request failed (${status})`);
    this.status = status;
    this.fields = Object.fromEntries((problem.success ? (problem.data.errors ?? []) : []).map((e) => [e.path, e.message]));
  }
}

// The words to show for any error thrown by api()
export const errorMessage = (err: unknown): string =>
  err instanceof ApiRequestError
    ? (Object.keys(err.fields).length > 0 && err.status === 422 ? Object.values(err.fields).join(". ") : err.message)
    : "Something went wrong. Check your connection and try again.";

// ONE refresh at a time. If several requests find the token expired together, they all wait for
// the SAME refresh: two refreshes with one cookie would look like a stolen cookie to the API
// (refresh-token reuse) and end the login.
let refreshing: Promise<AuthResponse | null> | null = null;

export const refreshSession = (): Promise<AuthResponse | null> => {
  refreshing ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.status === 409) {
          // Another tab refreshed this login a moment ago; its new cookie is ours too
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        const session = res.ok ? authResponseSchema.parse(await res.json()) : null;
        accessToken = session?.accessToken ?? null;
        return session;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

type Options = Omit<RequestInit, "body"> & { body?: unknown };

// fetch("/api" + path) with JSON in and out. Sends the access token if there is one; on a 401
// it refreshes once and tries again. Throws ApiRequestError for any non-2xx answer.
export const api = async <T = unknown>(path: string, { body, headers, ...init }: Options = {}): Promise<T> => {
  const send = () =>
    fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await send();
  if (res.status === 401 && accessToken && (await refreshSession())) {
    res = await send();
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(res.status, json);
  return json as T;
};
