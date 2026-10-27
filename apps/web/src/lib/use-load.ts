"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./client-api";

// GET an API path in a Client Component, checked with a schema:
//   const { data, error, loading, reload, setData } = useLoad("/admin/coupons", couponSchema.array());
// `path` null = don't load (yet). Changing it loads again; reload() fetches the same path again.
// While a new path loads, `data` still holds the PREVIOUS result (and `loading` is true), so a
// page can keep showing it, dimmed, instead of flashing empty.
// `schema` must be a stable object (a module-level schema, not one built during render).
export function useLoad<T>(path: string | null, schema: { parse: (value: unknown) => T }) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loadedPath: string | null }>({ data: null, error: null, loadedPath: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api(path)
      .then((body) => !cancelled && setState({ data: schema.parse(body), error: null, loadedPath: path }))
      .catch((err: unknown) => !cancelled && setState((s) => ({ ...s, error: errorMessage(err), loadedPath: path })));
    return () => {
      cancelled = true;
    };
  }, [path, schema, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data, error: null })), []);
  return { data: state.data, error: state.error, loading: path !== null && state.loadedPath !== path, reload, setData };
}
