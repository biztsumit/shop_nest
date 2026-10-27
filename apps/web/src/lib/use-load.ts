"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./client-api";

// GET an API path in a Client Component, checked with a schema:
//   const { data, error, reload, setData } = useLoad("/admin/coupons", couponSchema.array());
// `path` null = don't load (yet). Changing it loads again; reload() fetches the same path again.
// `schema` must be a stable object (a module-level schema, not one built during render).
export function useLoad<T>(path: string | null, schema: { parse: (value: unknown) => T }) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api(path)
      .then((body) => !cancelled && setState({ data: schema.parse(body), error: null }))
      .catch((err: unknown) => !cancelled && setState({ data: null, error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [path, schema, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((data: T) => setState({ data, error: null }), []);
  return { ...state, reload, setData };
}
