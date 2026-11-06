import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ShellProvider } from "@/components/shell/shell-provider";
import { MobileHeader, MobileTabBar, Sidebar } from "@/components/shell/sidebar";
import { SIDEBAR_COOKIE } from "@/lib/layout";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <ShellProvider initialCollapsed={collapsed}>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
          <MobileHeader />
          <main className="flex flex-1 flex-col">{children}</main>
        </div>
        <MobileTabBar />
      </div>
    </ShellProvider>
  );
}
