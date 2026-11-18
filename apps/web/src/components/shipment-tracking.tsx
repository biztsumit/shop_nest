import type { Shipment } from "@shop/shared";
import { ExternalLink } from "lucide-react";
import { buttonStyles } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

// "IN TRANSIT" → "In transit"
export const statusLabel = (status: string): string => status.charAt(0) + status.slice(1).toLowerCase();

// The parcel: who carries it, its tracking number, a link to follow it, and its journey so far
export function ShipmentTracking({ shipment, limit }: { shipment: Shipment; limit?: number }) {
  const events = limit ? shipment.events.slice(0, limit) : shipment.events;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {shipment.awb && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Courier</dt><dd>{shipment.courierName}</dd>
          <dt className="text-muted">Tracking no.</dt><dd className="font-mono break-all">{shipment.awb}</dd>
          <dt className="text-muted">Status</dt><dd>{statusLabel(shipment.status)} <span className="text-muted">· {formatDateTime(shipment.statusAt)}</span></dd>
        </dl>
      )}
      {shipment.trackingUrl && (
        <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: "secondary", size: "sm", className: "w-fit" })}>
          <ExternalLink className="size-4" aria-hidden /> Track parcel
        </a>
      )}
      {events.length > 0 && (
        <ol className="flex flex-col gap-2 border-l border-line pl-4">
          {events.map((e, i) => (
            <li key={`${e.at}-${e.status}`} className="relative">
              <span aria-hidden className={`absolute top-1.5 -left-[1.3rem] size-2 rounded-full ${i === 0 ? "bg-brand" : "bg-line"}`} />
              <span className="block font-medium">{e.activity || statusLabel(e.status)}</span>
              <span className="text-xs text-muted">{[e.location, formatDateTime(e.at)].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
