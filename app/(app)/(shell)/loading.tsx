import { Skeleton } from "@/components/ui/skeleton";

/** Route-level placeholder for shell pages: shapes, not a spinner. */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-6 py-8 md:px-10 md:py-12" aria-busy="true">
      <Skeleton className="h-10 w-48 rounded-button" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="aspect-square rounded-panel" />
        ))}
      </div>
    </div>
  );
}
