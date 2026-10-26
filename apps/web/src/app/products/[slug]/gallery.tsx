"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";

// The big photo, and a row of thumbnails that swap it
export function Gallery({ images, name }: { images: Array<{ url: string; alt: string }>; name: string }) {
  const [current, setCurrent] = useState(0);
  const image = images[current];

  if (!image) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-subtle text-faint">
        <ImageOff className="size-10" aria-hidden />
        <span className="text-sm">No photo yet</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-subtle">
        <Image src={image.url} alt={image.alt || name} fill priority sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2" role="group" aria-label="Photos">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setCurrent(i)}
              aria-label={`Photo ${i + 1}`}
              aria-pressed={i === current}
              className={cn("relative size-16 overflow-hidden rounded-lg border-2 bg-subtle sm:size-20", i === current ? "border-brand" : "border-transparent opacity-70 hover:opacity-100")}
            >
              <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
