import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the shape of Stripe's embedded form so nothing jumps when it arrives. */
export function CheckoutSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-control bg-surface p-6">
      <Skeleton className="h-6 w-1/3 rounded-button" />
      <Skeleton className="h-12 rounded-button" />
      <Skeleton className="h-12 rounded-button" />
      <div className="flex gap-4">
        <Skeleton className="h-12 flex-1 rounded-button" />
        <Skeleton className="h-12 flex-1 rounded-button" />
      </div>
      <Skeleton className="h-12 rounded-button" />
    </div>
  );
}
