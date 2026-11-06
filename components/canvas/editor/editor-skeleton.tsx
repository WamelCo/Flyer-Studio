import { Skeleton } from "@/components/ui/skeleton";
import { FORMATS } from "@/lib/canvas/formats";
import type { FlyerFormat } from "@/lib/canvas/types";

/** Editor chrome + a page-shaped placeholder at the project's exact aspect ratio. */
export function EditorSkeleton({ format = "poster" }: { format?: FlyerFormat }) {
  const { width, height } = FORMATS[format];
  return (
    <div className="fixed inset-0 flex flex-col bg-base" aria-busy="true" aria-label="Loading editor">
      <div className="material flex h-(--bar-height) items-center gap-3 px-3">
        <Skeleton className="size-8 rounded-button" />
        <Skeleton className="h-5 w-40 rounded-button" />
        <Skeleton className="ml-auto h-8 w-24 rounded-button" />
      </div>
      <div className="flex flex-1 items-center justify-center p-12">
        <Skeleton
          className="rounded-button"
          style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc((100dvh - 160px) * ${width / height}))` }}
        />
      </div>
    </div>
  );
}
