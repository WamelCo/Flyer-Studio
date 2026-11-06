import type { ReactNode } from "react";

import { PageTransition } from "@/components/shell/page-transition";

export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition className="flex min-h-full flex-1 flex-col">{children}</PageTransition>;
}
