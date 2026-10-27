"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type Point = { label: string; value: number; detail?: string };

// ₹45K, ₹1.2L (Indian compact: thousands, lakhs, crores) for axis ticks
const compact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 });
export const compactRupees = (paise: number): string => compact.format(paise / 100);

// Round the top of the scale up to a clean number (₹10K, ₹25K, ₹50K...), so ticks read easily
const niceMax = (max: number): number => {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
};

const HEIGHT = 240;
const M = { top: 12, right: 12, bottom: 28, left: 56 };

// One series over time, as an area: a 2px line over a faint wash of the same colour.
// - the crosshair snaps to the nearest point (readers aim at a day, not at a 2px line)
// - keyboard: focus the chart, then ← → move between points, with the same readout
// - every value is also in the table below ("Show as table"): the tooltip never gates
export function AreaChart({ points, label, format }: { points: Point[]; label: string; format: (v: number) => string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  // The chart fills its container, and redraws when the container's width changes
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);   // refunds can make a day's net negative
  const max = niceMax(Math.max(...values, 0));
  const innerW = width - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => M.top + innerH - ((v - min) / (max - min)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = points.length > 0 ? `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));
  // A few date labels along the bottom (first, last, and evenly between), never crowded
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 90))));
  // (a regular label too close to the last one is dropped, so the two never overlap)
  const last = points.length - 1;
  const xLabels = points.map((p, i) => ({ i, label: p.label })).filter(({ i }) => i === last || (i % every === 0 && last - i >= every / 2));

  const nearest = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return null;
    const i = Math.round(((clientX - rect.left - M.left) / innerW) * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, i));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActive((a) => Math.max(0, Math.min(points.length - 1, (a ?? points.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  const point = active === null ? null : points[active];
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-3">
      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${label}: ${points.length} days, total ${format(total)}. Use the left and right arrow keys to read each day.`}
          tabIndex={0}
          onPointerMove={(e: PointerEvent) => setActive(nearest(e.clientX))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? points.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
          className="block touch-none rounded-lg outline-offset-4"
        >
          {/* Recessive grid: solid 1px hairlines, one step off the surface */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{compactRupees(t)}</text>
            </g>
          ))}
          {xLabels.map(({ i, label: l }) => (
            <text key={i} x={x(i)} y={HEIGHT - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]">{l}</text>
          ))}
          <path d={area} fill="var(--chart)" fillOpacity={0.1} />
          <path d={line} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {point && active !== null && (
            <g aria-hidden>
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} stroke="var(--line-strong)" strokeWidth={1} />
              {/* The marker: 4px radius, with a 2px ring in the surface colour so it reads over the line */}
              <circle cx={x(active)} cy={y(point.value)} r={4} fill="var(--chart)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {point && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 flex flex-col rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-pop"
            style={{ left: Math.min(Math.max(x(active) - 70, 0), width - 150) }}
          >
            {/* Value first and strong; the date and detail follow */}
            <span className="font-semibold tabular-nums">{format(point.value)}</span>
            <span className="text-xs text-muted">{point.label}{point.detail && ` · ${point.detail}`}</span>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-muted hover:text-fg">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted uppercase"><tr><th scope="col" className="px-3 py-2 font-medium">Day</th><th scope="col" className="px-3 py-2 text-right font-medium">{label}</th><th scope="col" className="px-3 py-2 text-right font-medium">Details</th></tr></thead>
            <tbody className="divide-y divide-line">
              {points.map((p) => <tr key={p.label}><td className="px-3 py-1.5">{p.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{format(p.value)}</td><td className="px-3 py-1.5 text-right text-muted">{p.detail}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
