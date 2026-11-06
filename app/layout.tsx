import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { MotionProvider } from "@/components/providers/motion-provider";
import { PRODUCT_NAME } from "@/components/shell/wordmark";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: `${PRODUCT_NAME} — Flyers from a sentence`, template: `%s · ${PRODUCT_NAME}` },
  description: "Describe your event and get a print-ready, fully editable flyer in seconds.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F5F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-base text-fg">
        <MotionProvider>
          <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
