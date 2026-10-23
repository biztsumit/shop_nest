// Everything the API and the web app must agree on lives here, written ONCE.
// The API returns these shapes; the web app checks what it receives against the same schemas.
// Change a shape here and TypeScript points at every place, in both apps, that needs updating.
export * from "./health.js";
export * from "./problem.js";
