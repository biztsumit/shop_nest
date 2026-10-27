// Where the NestJS API runs, as the web SERVER reaches it (browsers only ever see /api on this
// site). Read in two places: next.config.ts (the /api/* rewrite) and lib/catalog.ts.
//
// Some hosts hand one service another's address as "host:port" without a scheme (Render's
// private network: "shop-nest-api:4000"); http:// is added then.
export const apiUrl = (value = process.env.API_URL): string => {
  const url = value?.trim() || "http://localhost:4000";
  return /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : `http://${url.replace(/\/+$/, "")}`;
};
