import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { Analytics } from "@/components/providers/analytics";
import { MotionProvider } from "@/components/providers/motion-provider";
import { PRODUCT_NAME } from "@/components/shell/wordmark";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// UI fallback for platforms without San Francisco (see --font-sans in globals.css).
const ui = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

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
    <html lang="en" className={ui.variable}>
      <body className="bg-base text-fg">
        <MotionProvider>
          <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
          <Analytics />
        </MotionProvider>
      </body>
    </html>
  );
}
