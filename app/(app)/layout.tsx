import type { ReactNode } from "react";

import { ViewerProvider } from "@/components/providers/viewer-provider";
import { requireViewer } from "@/lib/auth/viewer";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  return <ViewerProvider initialViewer={viewer}>{children}</ViewerProvider>;
}
