"use client";

import dynamic from "next/dynamic";

import type { FlyerDoc } from "@flyer/design/canvas/types";
import { cn } from "@/lib/utils";

const FlyerPreview = dynamic(() => import("@/components/canvas/flyer-preview"), { ssr: false });

export function GalleryLoader({ items, columns = 4 }: { items: { label: string; doc: FlyerDoc }[]; columns?: 3 | 4 }) {
  return (
    <div className={cn("grid items-start gap-6 bg-base p-6", columns === 3 ? "grid-cols-3" : "grid-cols-4")} data-gallery>
      {items.map((item) => (
        <figure key={item.label} className="flex flex-col gap-2">
          <div className="overflow-hidden shadow-page">
            <FlyerPreview doc={item.doc} />
          </div>
          <figcaption className="text-caption text-fg-secondary">{item.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
