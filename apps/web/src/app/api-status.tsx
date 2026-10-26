import { healthSchema, type Health } from "@shop/shared";
import { connection } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

// Asks the API how it's doing. The answer is checked against the SAME zod schema the API
// uses (from @shop/shared): if the two apps ever disagree about the shape, this fails loudly
// here instead of showing wrong data.
async function getHealth(): Promise<Health | null> {
  try {
    const res = await fetch(`${API_URL}/api/health`, { cache: "no-store" });
    return healthSchema.parse(await res.json());
  } catch {
    return null;
  }
}

export async function ApiStatus() {
  // "This depends on the moment of the request": never prerender it at build time
  await connection();
  const health = await getHealth();

  const rows: Array<[string, string, boolean]> = health
    ? [
        ["API", health.status === "ok" ? "Running" : "Degraded", health.status === "ok"],
        ["Database", health.database === "up" ? "Connected" : "Down", health.database === "up"],
        ["Uptime", `${health.uptimeSeconds}s`, true],
        ["Version", health.version, true],
      ]
    : [["API", "Unreachable: is it running on port 4000?", false]];

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card" aria-label="System status">
      <h2 className="mb-3 font-medium">System status</h2>
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map(([label, value, good]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <dt className="text-muted">{label}</dt>
            <dd className="flex items-center gap-2 font-medium">
              {/* The word says the state; the dot is only a visual extra */}
              <span className={`size-2 rounded-full ${good ? "bg-success" : "bg-danger"}`} aria-hidden />
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
