import { ApiRequestError, refreshSession } from "./client-api";

// Downloads a file from the API as the logged-in user. A plain <a href> can't send the
// Authorization header (the access token lives in memory), so the file is fetched here and
// handed to the browser as a temporary "blob:" link.
export const downloadFile = async (path: string, filename: string): Promise<void> => {
  const session = await refreshSession();   // a fresh token, and the cookie rotates as usual
  const res = await fetch(`/api${path}`, { headers: session ? { Authorization: `Bearer ${session.accessToken}` } : {} });
  if (!res.ok) throw new ApiRequestError(res.status, await res.json().catch(() => ({})));
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
